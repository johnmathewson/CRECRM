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
  // Ask background for live status (knows queue depth + heartbeat freshness)
  let status = null;
  try {
    status = await chrome.runtime.sendMessage({ action: "leads-watcher-status" });
  } catch {}

  const data = await chrome.storage.local.get(null);
  const lastRun = data.leads_watcher_last_run;
  const queueRemaining = status?.queue_remaining ?? 0;
  const heartbeatAge = status?.heartbeat_age_ms ?? null;

  // Per-listing telemetry, last 6 entries. Filter excludes the singleton
  // "leads_watcher_last_run" timestamp (a number, not a per-listing object).
  const perListing = Object.entries(data)
    .filter(([k, v]) =>
      k.startsWith("leads_watcher_last_") &&
      k !== "leads_watcher_last_run" &&
      v && typeof v === "object"
    )
    .map(([k, v]) => ({ id: k.replace("leads_watcher_last_", ""), ...v }))
    .sort((a, b) => (b.at || 0) - (a.at || 0))
    .slice(0, 6);

  let html = "";
  if (queueRemaining > 0 && heartbeatAge !== null && heartbeatAge < 5 * 60 * 1000) {
    html = `<span style="color:#F2C94C">Running — ${queueRemaining} listing${queueRemaining === 1 ? "" : "s"} left</span>`;
  } else if (queueRemaining > 0) {
    html = `<span style="color:#E74C3C">Stuck (${queueRemaining} left, no heartbeat). Click "Run now" to reset.</span>`;
  } else if (!lastRun) {
    html = `Hasn't run yet. Fires every 30 min when Chrome is open, or click below to run on demand.`;
  } else {
    const ago = Math.round((Date.now() - lastRun) / 60000);
    html = `<strong>Last run:</strong> ${ago < 1 ? "just now" : `${ago}m ago`}`;
  }
  if (perListing.length > 0) {
    html += `<div style="margin-top:6px; font-size:10.5px; color:rgba(240,237,228,0.5); max-height:200px; overflow-y:auto">`;
    for (const p of perListing) {
      const ago = Math.round((Date.now() - (p.at || 0)) / 60000);
      const isZeroLeads = p.ok && p.leads_count === 0;
      const status = !p.ok
        ? `failed: ${p.error || "?"}`
        : p.leads_count === 0
        ? `0 leads (page diagnostic ↓)`
        : `${p.leads_count} leads`;
      const color = p.ok && p.leads_count > 0
        ? "rgba(107,203,119,0.85)"
        : isZeroLeads
        ? "rgba(242,201,76,0.85)"
        : "rgba(231,76,60,0.85)";
      const verTag = p.watcher_version ? ` <span style="opacity:0.5">[${escapeHtml(p.watcher_version)}]</span>` : "";
      const emailNote = p.ok && p.leads_count > 0 && p.emails_captured !== undefined && p.emails_captured !== null
        ? ` · ${p.emails_captured}/${p.leads_count} emails`
        : "";
      html += `<div style="color:${color}; padding: 2px 0">· #${p.id} — ${status}${emailNote} · ${ago}m ago${verTag}</div>`;
      // Panel diagnostic when emails were missing
      if (p.ok && p.leads_count > 0 && p.emails_captured === 0 && p.panel_diagnostic) {
        const pd = p.panel_diagnostic;
        html += `<div style="color:rgba(242,201,76,0.8); font-size:10px; padding-left:10px; margin-top:3px">  panel scrape (lead 1): clicked &lt;${escapeHtml(pd.clicked_tag || "?")}${pd.clicked_role ? ` role=${escapeHtml(pd.clicked_role)}` : ""}&gt;, found=${pd.panel_found ? "✓" : "✗"}</div>`;
        if (pd.panel_found && pd.panel_tag) {
          html += `<div style="color:rgba(240,237,228,0.5); font-size:10px; padding-left:10px">    panel: &lt;${escapeHtml(pd.panel_tag)}&gt; class="${escapeHtml((pd.panel_class || "").slice(0,40))}"</div>`;
        }
        html += `<div style="color:rgba(240,237,228,0.45); font-size:10px; padding-left:10px">    aside text: ${pd.aside_text_before_len} → ${pd.aside_text_after_len} chars</div>`;
        if (Array.isArray(pd.emails_on_page_after) && pd.emails_on_page_after.length > 0) {
          html += `<div style="color:rgba(78,205,196,0.7); font-size:10px; padding-left:10px">    emails on page: [${pd.emails_on_page_after.map((e) => escapeHtml(e)).join(", ")}]</div>`;
        } else {
          html += `<div style="color:rgba(231,76,60,0.7); font-size:10px; padding-left:10px">    NO emails on page anywhere — panel didn't load lead detail</div>`;
        }
        if (pd.aside_text_sample) {
          html += `<div style="color:rgba(240,237,228,0.4); font-size:9.5px; padding-left:10px; max-width:300px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap" title="${escapeHtml(pd.aside_text_sample)}">    aside: ${escapeHtml(pd.aside_text_sample.slice(0, 80))}…</div>`;
        }
        if (Array.isArray(pd.candidate_panels) && pd.candidate_panels.length > 0) {
          html += `<div style="color:rgba(240,237,228,0.5); font-size:10px; padding-left:10px; margin-top:3px">    candidates:</div>`;
          for (const cp of pd.candidate_panels) {
            html += `<div style="color:rgba(240,237,228,0.4); font-size:9.5px; padding-left:18px">      &lt;${escapeHtml(cp.tag)}&gt; cls="${escapeHtml((cp.classes || "").slice(0,30))}" len=${cp.textLen}</div>`;
          }
        }
      }
      if (isZeroLeads && p.diagnostic) {
        const d = p.diagnostic;
        const summary = [
          d.probable_state ? `state: ${d.probable_state}` : null,
          `phones: ${d.phone_leaf_count ?? 0}`,
          `[role=row]=${d.counts?.role_row ?? 0}`,
        ].filter(Boolean).join(" · ");
        html += `<div style="color:rgba(240,237,228,0.45); font-size:10px; padding-left:10px">  ${summary}</div>`;

        // Dump row samples — the critical debug payload
        if (Array.isArray(d.row_samples) && d.row_samples.length > 0) {
          for (const rs of d.row_samples) {
            html += `<div style="color:rgba(78,205,196,0.7); font-size:9.5px; padding-left:10px; margin-top:4px">  📞 ${escapeHtml(rs.phone)}:</div>`;
            // Resolved row info
            if (rs.resolvedRow) {
              const r = rs.resolvedRow;
              html += `<div style="color:rgba(240,237,228,0.5); font-size:9px; padding-left:18px">    row=&lt;${escapeHtml(r.tag || "?")}${r.role ? ` role=${escapeHtml(r.role)}` : ""}&gt; leaves=${r.leafCount}</div>`;
              if (Array.isArray(r.leafTexts)) {
                html += `<div style="color:rgba(240,237,228,0.4); font-size:9px; padding-left:18px; max-width:300px">    leaves: [${r.leafTexts.map(t => escapeHtml(t)).join(" | ")}]</div>`;
              }
            } else {
              html += `<div style="color:rgba(231,76,60,0.7); font-size:9px; padding-left:18px">    NO ROW CONTAINER FOUND (walker fell through)</div>`;
              if (Array.isArray(rs.ancestors)) {
                for (const a of rs.ancestors) {
                  html += `<div style="color:rgba(240,237,228,0.4); font-size:9px; padding-left:18px">    L${a.depth}: &lt;${escapeHtml(a.tag)}${a.role ? ` role=${escapeHtml(a.role)}` : ""}&gt; ${a.classes ? `class="${escapeHtml(a.classes.slice(0,40))}"` : ""} children=${a.childCount} textLen=${a.textLen}</div>`;
                }
              }
            }
          }
        }
      }
    }
    html += `</div>`;
  }
  els.watcherStatus.innerHTML = html;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

els.runWatcherNow?.addEventListener("click", async () => {
  els.runWatcherNow.disabled = true;
  els.watcherStatus.innerHTML = `<span style="color:#F2C94C">Triggering…</span>`;
  try {
    await chrome.runtime.sendMessage({ action: "force-run-leads-watcher" });
  } catch (err) {
    console.warn("force run failed", err);
  }
  setTimeout(() => {
    els.runWatcherNow.disabled = false;
    refreshWatcherStatus();
  }, 1500);
});

init();
refreshWatcherStatus();
setInterval(refreshWatcherStatus, 5000);
