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
// Per-property timeout. First-run deep scrape clicks every lead to capture
// email + activity timeline — for 16 leads at ~3s each that's ~50s, plus
// table wait. We allow up to 180s so even a long-tail listing finishes.
const LEADS_TAB_TIMEOUT_MS = 180_000;
const LEADS_HEARTBEAT_STALE_MS = 10 * 60_000;  // 10 min stale → treat as dead

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

const WATCHER_VERSION = "v0.2.6-programmatic";

// Wait for a tab to reach status: "complete" before sending messages to it
function waitForTabComplete(tabId, timeoutMs = 30_000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = async () => {
      if (Date.now() - start > timeoutMs) {
        resolve({ ok: false, reason: "timeout waiting for complete" });
        return;
      }
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === "complete") {
          resolve({ ok: true });
          return;
        }
      } catch (err) {
        resolve({ ok: false, reason: `tab gone: ${err?.message || err}` });
        return;
      }
      setTimeout(check, 400);
    };
    check();
  });
}

async function scrapeOneListing(property) {
  console.log(`[stewardship leads ${WATCHER_VERSION}] start scraping property #${property.crexi_listing_id} (${property.name})`);

  // Always-write telemetry helper. Records what happened to chrome.storage
  // even on errors, so the popup never silently shows a stale entry.
  const writeTelemetry = async (entry) => {
    await chrome.storage.local.set({
      [`leads_watcher_last_${property.crexi_listing_id}`]: {
        at: Date.now(),
        watcher_version: WATCHER_VERSION,
        ...entry,
      },
    });
  };

  // Open as an ACTIVE TAB in the user's currently-focused window.
  //
  // Why this approach (after off-screen window failed silently): an active
  // foreground tab is the ONLY mode that guarantees Chrome runs JS at full
  // priority and that CREXi's frontend doesn't gate its data fetch on
  // visibility/focus state. Yes, it briefly takes focus from the user;
  // we restore their original tab as soon as scraping completes.
  let originalTabId = null;
  let scrapeTabId = null;

  try {
    // Note which tab the user was on, to restore it after
    const [activeBefore] = await chrome.tabs.query({ active: true, currentWindow: true });
    originalTabId = activeBefore?.id || null;
    console.log(`[stewardship leads] originalTabId=${originalTabId}`);

    // Create the scraping tab (becomes active)
    const tab = await chrome.tabs.create({
      url: property.leads_url,
      active: true,
    });
    scrapeTabId = tab?.id || null;
    console.log(`[stewardship leads] opened scrape tab id=${scrapeTabId}`);

    if (!scrapeTabId) {
      await writeTelemetry({ ok: false, error: "tabs.create returned no tab id", leads_count: 0 });
      return;
    }
  } catch (err) {
    const msg = String(err?.message || err);
    console.warn(`[stewardship leads] tab create failed:`, msg);
    await writeTelemetry({ ok: false, error: `create_tab_failed: ${msg}`, leads_count: 0 });
    return;
  }

  // STEP 1: Wait for the tab to reach "complete" status. This means the
  // page has finished its initial load (DOMContentLoaded + onLoad). The
  // Angular SPA may keep doing background work after this, but the JS
  // runtime is ready for content script injection.
  console.log(`[stewardship leads] waiting for tab to reach complete status...`);
  const tabReady = await waitForTabComplete(scrapeTabId, 25_000);
  if (!tabReady.ok) {
    console.warn(`[stewardship leads] tab never reached complete: ${tabReady.reason}`);
    if (originalTabId !== null) {
      try { await chrome.tabs.update(originalTabId, { active: true }); } catch {}
    }
    try { await chrome.tabs.remove(scrapeTabId); } catch {}
    await writeTelemetry({
      ok: false,
      error: `tab_load_${tabReady.reason}`,
      leads_count: 0,
    });
    return;
  }
  console.log(`[stewardship leads] tab reached complete status, proceeding`);

  // STEP 2: Programmatically inject the content script. We DON'T rely on
  // the manifest's content_scripts auto-injection because document_idle
  // can fail on heavy Angular SPAs. Programmatic injection is explicit
  // and gives us a clear error if it fails.
  try {
    await chrome.scripting.executeScript({
      target: { tabId: scrapeTabId },
      files: ["content-crexi-leads.js"],
    });
    console.log(`[stewardship leads] content script injected programmatically`);
  } catch (err) {
    const msg = String(err?.message || err);
    console.warn(`[stewardship leads] injection failed: ${msg}`);
    if (originalTabId !== null) {
      try { await chrome.tabs.update(originalTabId, { active: true }); } catch {}
    }
    try { await chrome.tabs.remove(scrapeTabId); } catch {}
    await writeTelemetry({ ok: false, error: `inject_failed: ${msg}`, leads_count: 0 });
    return;
  }

  // STEP 3: Wait briefly for the listener to register, then send scrape
  // request and wait for response.
  await new Promise((r) => setTimeout(r, 500));

  const result = await new Promise((resolve) => {
    let settled = false;
    const finish = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const timer = setTimeout(() => {
      console.warn(`[stewardship leads] scrape timeout after ${LEADS_TAB_TIMEOUT_MS}ms`);
      finish({ ok: false, error: "scrape_timeout" });
    }, LEADS_TAB_TIMEOUT_MS);

    let attemptCount = 0;
    const tryOnce = async () => {
      if (settled) return;
      attemptCount += 1;
      try {
        const r = await chrome.tabs.sendMessage(scrapeTabId, { action: "scrape-leads" });
        if (r) {
          console.log(`[stewardship leads] scrape result on attempt ${attemptCount}:`, JSON.stringify({ ok: r.ok, leads_count: r.leads_count, has_diagnostic: !!r.diagnostic }));
          finish(r);
          return;
        }
      } catch (err) {
        if (attemptCount === 1 || attemptCount % 5 === 0) {
          console.log(`[stewardship leads] sendMessage attempt ${attemptCount}: ${err?.message || err}`);
        }
      }
      if (!settled) setTimeout(tryOnce, 1500);
    };
    tryOnce();
  });

  // Restore the user's original tab BEFORE closing the scrape tab to
  // avoid a flash of "no active tab" state
  if (originalTabId !== null) {
    try {
      await chrome.tabs.update(originalTabId, { active: true });
      console.log(`[stewardship leads] restored original tab id=${originalTabId}`);
    } catch (err) {
      console.warn(`[stewardship leads] couldn't restore original tab: ${err?.message || err}`);
    }
  }

  // Close the scrape tab
  try {
    await chrome.tabs.remove(scrapeTabId);
    console.log(`[stewardship leads] closed scrape tab id=${scrapeTabId}`);
  } catch (err) {
    console.warn(`[stewardship leads] couldn't close scrape tab: ${err?.message || err}`);
  }

  await writeTelemetry({
    ok: !!result?.ok,
    leads_count: result?.leads_count || 0,
    error: result?.ok ? null : result?.error || null,
    diagnostic: result?.diagnostic || null,
  });
  console.log(`[stewardship leads] done #${property.crexi_listing_id}: ok=${!!result?.ok} count=${result?.leads_count || 0}`);
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
