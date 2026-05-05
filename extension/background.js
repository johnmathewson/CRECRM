/**
 * Background service worker.
 *
 * Three jobs:
 *   1. POLL_ALARM (1 min) — checks /api/extension/pending for owner-dashboard
 *      sync requests. When a request is waiting, fires "sync" message into
 *      any matching open CREXi/LoopNet tab.
 *   2. LEADS_ALARM (30 min) — drives the CREXi leads watcher. Pulls list of
 *      active properties from /api/extension/properties, opens each one's
 *      dashboard/leads URL in a hidden background tab one at a time, asks
 *      the content script to scrape, then closes the tab. Sleeps 90s
 *      between properties so we never have more than one hidden tab open
 *      and CREXi never sees a burst of activity.
 *   3. Maintains both alarms across service-worker restarts.
 */

const POLL_ALARM = "stewardship-poll";        // 1 min — owner-dashboard pending
const LEADS_ALARM = "stewardship-leads";      // 30 min — CREXi leads watcher
const LEADS_PER_PROPERTY_DELAY_MS = 90_000;   // Pause between properties
const LEADS_TAB_TIMEOUT_MS = 60_000;          // Max time to wait for one property's scrape
const LEADS_RUNNING_FLAG = "leads_watcher_running";

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 1 });
  chrome.alarms.create(LEADS_ALARM, { periodInMinutes: 30, delayInMinutes: 1 });
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 1 });
  chrome.alarms.create(LEADS_ALARM, { periodInMinutes: 30, delayInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === POLL_ALARM) {
    await pollAndDispatch();
  } else if (alarm.name === LEADS_ALARM) {
    await runLeadsWatcher();
  }
});

// ── Owner-dashboard pending poller (existing behavior) ─────────────────────

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
        } catch {
          // Content script may not be ready
        }
      }
    }
  }
}

// ── CREXi leads watcher ────────────────────────────────────────────────────

async function runLeadsWatcher() {
  const cfg = await chrome.storage.local.get(["crmUrl", "apiKey", LEADS_RUNNING_FLAG, "leadsWatcherEnabled"]);

  // Default ON. User can disable via options page if needed.
  if (cfg.leadsWatcherEnabled === false) return;

  if (!cfg.apiKey) return;

  // Single-flight guard. If a previous cycle is still running (e.g. stuck
  // tab), skip this one. The flag has a 30-min TTL via the alarm cadence;
  // if it's older than 90 min, we assume the previous run died and clear.
  const startedAt = cfg[LEADS_RUNNING_FLAG];
  if (startedAt && Date.now() - startedAt < 90 * 60 * 1000) {
    return;
  }

  await chrome.storage.local.set({ [LEADS_RUNNING_FLAG]: Date.now() });

  const baseUrl = (cfg.crmUrl || "https://stewardship-crm.netlify.app").replace(/\/+$/, "");

  try {
    // Pull the list of active properties to iterate over
    const res = await fetch(`${baseUrl}/api/extension/properties`, {
      headers: { "x-extension-key": cfg.apiKey },
    });
    if (!res.ok) return;
    const { properties = [] } = await res.json();

    // Iterate one at a time, with a delay between, to avoid bursting
    for (const p of properties) {
      if (!p.leads_url || !p.crexi_listing_id) continue;
      try {
        await scrapeOneListing(p);
      } catch (err) {
        console.warn("[stewardship leads watcher] property failed", p.name, err);
      }
      await sleep(LEADS_PER_PROPERTY_DELAY_MS);
    }
  } finally {
    await chrome.storage.local.remove(LEADS_RUNNING_FLAG);
    // Record last run time for the popup/options to display
    await chrome.storage.local.set({ leads_watcher_last_run: Date.now() });
  }
}

async function scrapeOneListing(property) {
  // Open a background tab. active:false means it doesn't steal focus.
  const tab = await chrome.tabs.create({
    url: property.leads_url,
    active: false,
  });
  if (!tab?.id) return;

  // Wait for the content script to be ready (it auto-injects via manifest).
  // Then ask it to scrape. If it auto-fired on page load already, our
  // explicit call returns the same shape but pulls fresh data.
  const result = await new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve({ ok: false, error: "timeout" });
      }
    }, LEADS_TAB_TIMEOUT_MS);

    // Poll: send the scrape message every 2s until the content script
    // responds OR we hit the timeout. The first 1-2 sends may fail because
    // the script isn't injected yet on a brand-new tab.
    const tryOnce = async () => {
      if (settled) return;
      try {
        const r = await chrome.tabs.sendMessage(tab.id, { action: "scrape-leads" });
        if (r) {
          settled = true;
          clearTimeout(timer);
          resolve(r);
          return;
        }
      } catch {
        // content script not ready yet — retry
      }
      setTimeout(tryOnce, 2000);
    };
    // Give the page a moment to start loading before first attempt
    setTimeout(tryOnce, 4000);
  });

  // Always close the tab, even on failure
  try {
    await chrome.tabs.remove(tab.id);
  } catch {}

  // Telemetry — store the most recent run per property for popup display
  await chrome.storage.local.set({
    [`leads_watcher_last_${property.crexi_listing_id}`]: {
      at: Date.now(),
      ok: !!result?.ok,
      leads_count: result?.leads_count || 0,
      error: result?.ok ? null : result?.error || null,
    },
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
