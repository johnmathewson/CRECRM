/**
 * Background service worker.
 *
 * Three jobs:
 *   1. POLL_ALARM (1 min) — checks /api/extension/pending for owner-dashboard
 *      sync requests. When a request is waiting, fires "sync" message into
 *      any matching open CREXi/LoopNet tab.
 *   2. LEADS_CYCLE_START (every 30 min) — kicks off a CREXi leads watcher
 *      cycle by fetching the property list and stashing it in chrome.storage
 *      as a queue. Schedules the first LEADS_STEP alarm.
 *   3. LEADS_STEP (chained, 10s spacing) — pops one property off the queue,
 *      scrapes its leads dashboard, and schedules the next step. Each step
 *      runs in its own fresh service-worker invocation so Manifest V3's
 *      aggressive worker-kill behavior never strands a cycle mid-run.
 *
 * Why chained alarms, not one big run:
 *   Chrome Manifest V3 service workers are killed after ~30 seconds of
 *   apparent inactivity. A long Promise-based loop with sleeps gets shut
 *   down mid-cycle. Chained alarms give each property its own short,
 *   wide-awake invocation that always cleans up its state.
 */

const POLL_ALARM = "stewardship-poll";
const LEADS_CYCLE_START = "stewardship-leads-cycle";
const LEADS_STEP = "stewardship-leads-step";

const LEADS_STEP_SPACING_MS = 10_000;     // Between properties
const LEADS_TAB_TIMEOUT_MS = 30_000;      // Per-property scrape ceiling
const LEADS_HEARTBEAT_STALE_MS = 5 * 60_000;  // Heartbeat older than 5 min = dead

// Storage keys
const KEY_QUEUE = "leads_watcher_queue";        // Array of property objects to scrape
const KEY_HEARTBEAT = "leads_watcher_heartbeat";  // Last activity timestamp
const KEY_LAST_RUN = "leads_watcher_last_run";    // Last completed cycle
const KEY_DISABLED = "leadsWatcherEnabled";       // User toggle (default true)

chrome.runtime.onInstalled.addListener(setupAlarms);
chrome.runtime.onStartup.addListener(setupAlarms);

function setupAlarms() {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 1 });
  chrome.alarms.create(LEADS_CYCLE_START, { periodInMinutes: 30, delayInMinutes: 1 });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  try {
    if (alarm.name === POLL_ALARM) {
      await pollAndDispatch();
    } else if (alarm.name === LEADS_CYCLE_START) {
      await startLeadsCycle();
    } else if (alarm.name === LEADS_STEP) {
      await processNextLeadsStep();
    }
  } catch (err) {
    console.warn("[stewardship] alarm handler failed", alarm.name, err);
  }
});

// ── Owner-dashboard pending poller (unchanged) ─────────────────────────────

async function pollAndDispatch() {
  const cfg = await chrome.storage.local.get(["crmUrl", "apiKey"]);
  if (!cfg.apiKey) return;
  const url = (cfg.crmUrl || "https://stewardship-crm.netlify.app").replace(/\/+$/, "");

  let pending;
  try {
    const res = await fetch(`${url}/api/extension/pending`, {
      headers: { "x-extension-key": cfg.apiKey },
    });
    if (!res.ok) return;
    const data = await res.json();
    pending = data.pending || [];
  } catch {
    return;
  }
  if (pending.length === 0) return;

  const tabs = await chrome.tabs.query({});
  for (const req of pending) {
    const property = req.property;
    if (!property) continue;
    const wantedSources =
      req.source === "any" ? ["crexi", "loopnet"] :
      req.source ? [req.source] : ["crexi", "loopnet"];

    for (const src of wantedSources) {
      const url = src === "crexi" ? property.crexi_url : property.loopnet_url;
      if (!url) continue;
      const matching = tabs.find((t) => t.url && url && t.url.startsWith(url.split("?")[0]));
      if (matching) {
        try {
          await chrome.tabs.sendMessage(matching.id, { action: "sync" });
        } catch {}
      }
    }
  }
}

// ── CREXi leads watcher: chained-alarm design ─────────────────────────────

/**
 * Step 1: Cycle start. Fetches the property list and stashes it as a queue.
 * Then schedules the first LEADS_STEP. If a previous queue is still
 * "alive" (heartbeat younger than the stale threshold), we leave it alone
 * and let it keep draining; this only kicks off a NEW cycle if the
 * previous one is genuinely done or dead.
 */
async function startLeadsCycle() {
  const cfg = await chrome.storage.local.get([KEY_DISABLED, KEY_QUEUE, KEY_HEARTBEAT, "apiKey", "crmUrl"]);
  if (cfg[KEY_DISABLED] === false) return;
  if (!cfg.apiKey) return;

  // Honor an in-flight cycle if its heartbeat is fresh
  const queue = cfg[KEY_QUEUE] || [];
  const heartbeat = cfg[KEY_HEARTBEAT] || 0;
  const heartbeatAge = Date.now() - heartbeat;
  if (queue.length > 0 && heartbeatAge < LEADS_HEARTBEAT_STALE_MS) {
    // Previous cycle still healthy; nudge it forward in case the chain broke
    await chrome.alarms.create(LEADS_STEP, { when: Date.now() + 1000 });
    return;
  }

  // Stale or empty — start fresh
  const baseUrl = (cfg.crmUrl || "https://stewardship-crm.netlify.app").replace(/\/+$/, "");
  let properties = [];
  try {
    const res = await fetch(`${baseUrl}/api/extension/properties`, {
      headers: { "x-extension-key": cfg.apiKey },
    });
    if (res.ok) {
      const data = await res.json();
      properties = data.properties || [];
    }
  } catch (err) {
    console.warn("[stewardship leads] property list fetch failed", err);
    return;
  }
  if (properties.length === 0) {
    await chrome.storage.local.set({ [KEY_LAST_RUN]: Date.now() });
    return;
  }

  await chrome.storage.local.set({
    [KEY_QUEUE]: properties,
    [KEY_HEARTBEAT]: Date.now(),
  });
  // Trigger the first step immediately
  await chrome.alarms.create(LEADS_STEP, { when: Date.now() + 500 });
}

/**
 * Step 2: Pop the next property off the queue, scrape it, schedule the
 * next step. Designed to complete in well under Chrome's worker-idle
 * killing threshold so we never get killed mid-property.
 */
async function processNextLeadsStep() {
  const cfg = await chrome.storage.local.get([KEY_QUEUE, "apiKey"]);
  const queue = cfg[KEY_QUEUE] || [];

  if (queue.length === 0) {
    // Cycle complete
    await chrome.storage.local.remove([KEY_QUEUE, KEY_HEARTBEAT]);
    await chrome.storage.local.set({ [KEY_LAST_RUN]: Date.now() });
    return;
  }

  const [next, ...rest] = queue;
  // Save the rest BEFORE we start scraping — if we die mid-scrape, the
  // next cycle picks up where we left off.
  await chrome.storage.local.set({
    [KEY_QUEUE]: rest,
    [KEY_HEARTBEAT]: Date.now(),
  });

  if (next?.leads_url && next?.crexi_listing_id) {
    try {
      await scrapeOneListing(next);
    } catch (err) {
      console.warn("[stewardship leads] property failed", next.name, err);
      await chrome.storage.local.set({
        [`leads_watcher_last_${next.crexi_listing_id}`]: {
          at: Date.now(),
          ok: false,
          leads_count: 0,
          error: String(err?.message || err),
        },
      });
    }
  }

  // Schedule the next step
  await chrome.storage.local.set({ [KEY_HEARTBEAT]: Date.now() });
  if (rest.length > 0) {
    await chrome.alarms.create(LEADS_STEP, {
      when: Date.now() + LEADS_STEP_SPACING_MS,
    });
  } else {
    // Queue empty — clean up
    await chrome.storage.local.remove([KEY_QUEUE, KEY_HEARTBEAT]);
    await chrome.storage.local.set({ [KEY_LAST_RUN]: Date.now() });
  }
}

async function scrapeOneListing(property) {
  // Open hidden tab
  const tab = await chrome.tabs.create({
    url: property.leads_url,
    active: false,
  });
  if (!tab?.id) return;

  const tabId = tab.id;

  // Wait for content script + ask it to scrape. Chained retries every 2s
  // until the script responds OR we hit the per-tab timeout.
  const result = await new Promise((resolve) => {
    let settled = false;
    const finish = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const timer = setTimeout(() => finish({ ok: false, error: "timeout" }), LEADS_TAB_TIMEOUT_MS);

    const tryOnce = async () => {
      if (settled) return;
      try {
        const r = await chrome.tabs.sendMessage(tabId, { action: "scrape-leads" });
        if (r) {
          finish(r);
          return;
        }
      } catch {
        // content script not ready yet
      }
      if (!settled) setTimeout(tryOnce, 2000);
    };
    setTimeout(tryOnce, 3000);
  });

  // Always close the tab
  try {
    await chrome.tabs.remove(tabId);
  } catch {}

  // Telemetry — last run per property (with diagnostic if 0 leads)
  await chrome.storage.local.set({
    [`leads_watcher_last_${property.crexi_listing_id}`]: {
      at: Date.now(),
      ok: !!result?.ok,
      leads_count: result?.leads_count || 0,
      error: result?.ok ? null : result?.error || null,
      diagnostic: result?.diagnostic || null,
    },
  });
}

// ── Manual triggers (popup → background) ──────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.action === "force-run-leads-watcher") {
    (async () => {
      // Forcefully clear stuck state and start fresh
      await chrome.storage.local.remove([KEY_QUEUE, KEY_HEARTBEAT]);
      await startLeadsCycle();
      sendResponse({ ok: true });
    })();
    return true;
  }
  if (msg?.action === "leads-watcher-status") {
    (async () => {
      const cfg = await chrome.storage.local.get([KEY_QUEUE, KEY_HEARTBEAT, KEY_LAST_RUN]);
      sendResponse({
        queue_remaining: (cfg[KEY_QUEUE] || []).length,
        heartbeat_at: cfg[KEY_HEARTBEAT] || null,
        heartbeat_age_ms: cfg[KEY_HEARTBEAT] ? Date.now() - cfg[KEY_HEARTBEAT] : null,
        last_run_at: cfg[KEY_LAST_RUN] || null,
      });
    })();
    return true;
  }
});
