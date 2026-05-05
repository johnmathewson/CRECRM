// Popup logic. Talks to the active tab's content script via chrome.tabs.sendMessage.

const els = {
  status: document.getElementById("status"),
  sync: document.getElementById("sync"),
  settings: document.getElementById("settings"),
  meta: document.getElementById("meta"),
  openOptions: document.getElementById("open-options"),
  watcherStatus: document.getElementById("watcher-status"),
  runWatcherNow: document.getElementById("run-watcher-now"),
};

function setStatus(msg, kind = "") {
  els.status.textContent = msg;
  els.status.className = `status ${kind}`;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function detectSource(url) {
  if (!url) return null;
  if (
    url.includes("crexi.com/properties/") ||
    url.includes("crexi.com/property/") ||
    url.includes("crexi.com/dashboard")
  ) return "crexi";
  if (/loopnet\.com\/(Listing|listing|products)\//.test(url)) return "loopnet";
  return null;
}

async function init() {
  const cfg = await chrome.storage.local.get(["apiKey"]);
  if (!cfg.apiKey) {
    setStatus("No API key set. Click Settings to configure.", "warn");
    els.sync.disabled = true;
    return;
  }

  const tab = await getActiveTab();
  const source = detectSource(tab?.url);

  if (!source) {
    setStatus("Open a CREXi or LoopNet listing page, then click Sync.", "warn");
    els.sync.disabled = true;
    return;
  }

  setStatus(`Ready to sync this ${source.toUpperCase()} listing.`, "ok");

  // Show last sync time for this source if we've stored one
  const last = await chrome.storage.local.get([`last_sync_${source}`]);
  if (last[`last_sync_${source}`]) {
    const ago = Math.round((Date.now() - last[`last_sync_${source}`]) / 60000);
    els.meta.innerHTML = `<strong>Last ${source} sync:</strong> ${ago < 1 ? "just now" : `${ago}m ago`}`;
  }
}

els.sync.addEventListener("click", async () => {
  setStatus("Syncing…");
  els.sync.disabled = true;

  const tab = await getActiveTab();
  const source = detectSource(tab?.url);
  if (!source) {
    setStatus("Couldn't detect listing source.", "err");
    els.sync.disabled = false;
    return;
  }

  try {
    const result = await chrome.tabs.sendMessage(tab.id, { action: "sync" });
    if (result?.ok) {
      const m = result.metrics || {};
      const total = (m.views || 0) + (m.saves || 0) + (m.inquiries || 0) + (m.downloads || 0);
      setStatus(`✓ Synced. ${m.views ?? 0} views recorded.`, "ok");
      await chrome.storage.local.set({ [`last_sync_${source}`]: Date.now() });

      if (total === 0 && result.scrapedDebug?.candidates?.length) {
        // Help us tune selectors: show up to 8 label/number candidates we found.
        const sample = result.scrapedDebug.candidates
          .slice(0, 8)
          .map((c) => `· ${c.label}: ${c.value}`)
          .join("<br>");
        els.meta.innerHTML =
          `<strong>No metrics matched our labels.</strong> ` +
          `Numbers we did find on this page:<br>${sample}` +
          `<br><br>If you see the right metrics here, copy this whole list and send it to John — ` +
          `we'll tune the label list.`;
      } else {
        els.meta.innerHTML = `<strong>Last ${source} sync:</strong> just now`;
      }
    } else {
      setStatus(result?.error || "Sync failed", "err");
      if (result?.hint) {
        els.meta.innerHTML = `<strong>How to fix:</strong> ${result.hint}`;
      }
    }
  } catch (err) {
    // Content script may not be injected if URL doesn't match patterns.
    setStatus("Page not ready. Reload the listing tab and try again.", "err");
  } finally {
    els.sync.disabled = false;
  }
});

els.settings.addEventListener("click", () => chrome.runtime.openOptionsPage());
els.openOptions.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

// ── Leads watcher status panel ───────────────────────────────────────────
async function refreshWatcherStatus() {
  const data = await chrome.storage.local.get(null);
  const lastRun = data.leads_watcher_last_run;
  const isRunning = data.leads_watcher_running;
  const perListing = Object.entries(data)
    .filter(([k]) => k.startsWith("leads_watcher_last_"))
    .map(([k, v]) => ({ id: k.replace("leads_watcher_last_", ""), ...v }))
    .sort((a, b) => (b.at || 0) - (a.at || 0))
    .slice(0, 4);

  let html = "";
  if (isRunning) {
    html = `<span style="color:#F2C94C">Running now…</span>`;
  } else if (!lastRun) {
    html = `Hasn't run yet. Fires every 30 min when Chrome is open, or click below to run on demand.`;
  } else {
    const ago = Math.round((Date.now() - lastRun) / 60000);
    html = `<strong>Last run:</strong> ${ago < 1 ? "just now" : `${ago}m ago`}`;
  }
  if (perListing.length > 0) {
    html += `<div style="margin-top:6px; font-size:10.5px; color:rgba(240,237,228,0.5)">`;
    for (const p of perListing) {
      const ago = Math.round((Date.now() - (p.at || 0)) / 60000);
      const status = p.ok ? `${p.leads_count} leads` : `failed (${p.error || "?"})`;
      html += `<div>· #${p.id} — ${status} · ${ago}m ago</div>`;
    }
    html += `</div>`;
  }
  els.watcherStatus.innerHTML = html;
}

els.runWatcherNow?.addEventListener("click", async () => {
  els.runWatcherNow.disabled = true;
  els.watcherStatus.innerHTML = `<span style="color:#F2C94C">Triggering…</span>`;
  // Trigger the alarm by setting a one-shot alarm immediately
  await chrome.alarms.create("stewardship-leads", { when: Date.now() + 1000 });
  setTimeout(() => {
    els.runWatcherNow.disabled = false;
    refreshWatcherStatus();
  }, 3000);
});

init();
refreshWatcherStatus();
setInterval(refreshWatcherStatus, 5000);
