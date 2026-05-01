/**
 * Background service worker.
 *
 * Two jobs:
 *   1. Periodic poll of /api/extension/pending — when the CRM has a sync
 *      request waiting (e.g. owner viewed dashboard, manual button), fire
 *      a "sync" message into any matching open CREXi/LoopNet tab.
 *   2. Maintain alarms; service worker can be killed at any time, alarms
 *      wake it back up.
 */

const POLL_ALARM = "stewardship-poll";

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 1 });
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== POLL_ALARM) return;
  await pollAndDispatch();
});

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

  // For each pending request, check if a relevant tab is open. If yes,
  // tell the content script to sync. The content script handles the
  // actual scraping + POST + marking the request fulfilled.
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
      // Find an open tab matching the listing's URL
      const matching = tabs.find((t) => t.url && url && t.url.startsWith(url.split("?")[0]));
      if (matching) {
        try {
          await chrome.tabs.sendMessage(matching.id, { action: "sync" });
        } catch {
          // Content script may not be ready; skip silently
        }
      }
    }
  }
}
