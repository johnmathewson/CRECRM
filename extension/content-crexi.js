/**
 * CREXi content script — runs on crexi.com listing + dashboard pages.
 *
 * Strategy: scrape metrics from the listing's owner-facing dashboard. CREXi
 * shows views / saves / inquiries / leads on listing detail pages and on the
 * "My Listings" dashboard. The selectors below cover the common shapes;
 * if CREXi changes their DOM, the patterns degrade gracefully (return zero)
 * instead of crashing — and the popup will report the partial result.
 */

(function () {
  const POLL_INTERVAL_MS = 60_000;     // How often the BG worker pings us for metrics
  const AUTO_SYNC_AFTER_MS = 6 * 60 * 60_000; // 6h between auto-syncs per listing

  // ── Listing ID extraction ────────────────────────────────────────────────
  function extractListingId() {
    // CREXi listing URLs come in a few shapes:
    //   /properties/12345/state-city-name      (public listing page)
    //   /property/12345/dashboard              (seller dashboard)
    //   /property/12345                        (other seller views)
    const m = window.location.pathname.match(/\/(?:properties|property)\/(\d+)/);
    return m ? m[1] : null;
  }

  // ── Metric extraction ────────────────────────────────────────────────────
  // Strategy: scan every numeric leaf node, pair it with its nearest
  // non-numeric text sibling (the label), then look the label up against
  // each metric's keyword list. This is more reliable than walking UP from
  // a label and grabbing the first numeric descendant, because CREXi lays
  // out all stat tiles in one parent container — walking up from "Offers"
  // would otherwise grab the "50" from the Leads tile (first numeric in
  // the shared container's DOM order).
  function findMetricByLabel(candidates, labelKeywords) {
    for (const c of candidates) {
      const lower = c.label.toLowerCase();
      if (labelKeywords.some((kw) => lower === kw || lower.includes(kw))) {
        return { value: c.value, foundLabel: lower };
      }
    }
    return { value: 0, foundLabel: null };
  }

  // Collect every label-ish + number pair on the page so we can tune
  // selectors when CREXi rephrases. Returned as `debug.candidates`.
  function collectAllLabeledNumbers() {
    const out = [];
    const numericNodes = Array.from(document.querySelectorAll("body *"))
      .filter(
        (n) =>
          n.children.length === 0 &&
          /^[\d,]+$/.test((n.textContent || "").trim()) &&
          parseInt(n.textContent.replace(/,/g, ""), 10) > 0
      );
    for (const numNode of numericNodes.slice(0, 60)) {
      // Walk up looking for a short label sibling
      let cursor = numNode.parentElement;
      let label = null;
      for (let i = 0; i < 3 && cursor && !label; i++) {
        const sibTexts = Array.from(cursor.querySelectorAll("*"))
          .filter(
            (n) =>
              n !== numNode &&
              n.children.length === 0 &&
              n.textContent &&
              n.textContent.trim().length > 0 &&
              n.textContent.trim().length < 40 &&
              !/^[\d,]+$/.test(n.textContent.trim())
          )
          .map((n) => n.textContent.trim());
        if (sibTexts.length > 0) label = sibTexts[0];
        cursor = cursor.parentElement;
      }
      if (label) {
        out.push({ label: label.slice(0, 50), value: parseInt(numNode.textContent.replace(/,/g, ""), 10) });
      }
    }
    return out;
  }

  // Wait for the dashboard's async KPI tiles to render before scraping.
  // CREXi loads metrics via a separate API call; if we scrape immediately on
  // popup-click, the Impressions/Page Views/Visitors tiles may not be in the
  // DOM yet. Poll up to 6 seconds for at least 4 candidates with non-zero
  // numeric labels, which is the steady-state for a populated dashboard.
  async function waitForKPIs(maxWaitMs = 6000) {
    const start = Date.now();
    let lastCount = 0;
    while (Date.now() - start < maxWaitMs) {
      const candidates = collectAllLabeledNumbers();
      // Stop early if we've seen the dashboard "settle" — same count on two
      // consecutive 250ms ticks AND at least 4 non-zero numbers visible.
      if (candidates.length >= 4 && candidates.length === lastCount) {
        return candidates;
      }
      lastCount = candidates.length;
      await new Promise((r) => setTimeout(r, 250));
    }
    return collectAllLabeledNumbers();
  }

  async function scrape() {
    const id = extractListingId();
    if (!id) return null;

    // CREXi seller dashboard labels (verified live May 2026):
    //   "Impressions"  → impressions      (search-result eyeballs)
    //   "Page Views"   → page_views       (clicked-into the listing)
    //   "Visitors"     → unique_visitors  (deduped page-view audience)
    //   "Opened OMs"   → opened_oms       (engaged — opened the OM)
    //   "Executed CAs" → executed_cas     (serious — signed NDA)
    //   "Offers"       → offers           (real money on the table)
    //   "Leads"        → inquiries        (only present on some listing surfaces)
    // We send BOTH new CREXi-native fields AND the legacy generic ones for
    // backward-compat with the CRM's older API contract (LoopNet still uses
    // the generic shape). Backend prefers the specific fields when present.
    const candidates = await waitForKPIs();

    const impressions = findMetricByLabel(candidates, [
      "impressions", "impression", "listing impressions", "search impressions",
    ]);
    const pageViews = findMetricByLabel(candidates, [
      "page views", "page view", "listing views", "total views",
      "30 day views", "30-day views",
    ]);
    const uniqueVisitors = findMetricByLabel(candidates, [
      "visitors", "unique visitors", "viewers",
    ]);
    const saves = findMetricByLabel(candidates, [
      "saves", "saved", "watchlists", "watchlist", "favorites",
    ]);
    const inquiries = findMetricByLabel(candidates, [
      "leads", "inquiries", "messages", "contacts", "lead submissions",
    ]);
    const openedOms = findMetricByLabel(candidates, [
      "opened oms", "opened om", "om opens", "om downloads",
      "documents downloaded", "document downloads", "brochure downloads",
    ]);
    const executedCas = findMetricByLabel(candidates, [
      "executed cas", "executed ca", "ca executions",
      "ndas signed", "nda signatures", "executed ndas",
    ]);
    const offers = findMetricByLabel(candidates, ["offers", "offers received"]);

    // Legacy "views" gets the most useful single value: page_views > unique
    // > impressions. Older dashboard code that hasn't been refactored yet
    // still has something meaningful to display.
    const legacyViews = pageViews.value || uniqueVisitors.value || impressions.value || 0;

    return {
      external_listing_id: id,
      external_url: window.location.href.split("?")[0],
      metrics: {
        // CREXi-native (preferred)
        impressions: impressions.value,
        page_views: pageViews.value,
        unique_visitors: uniqueVisitors.value,
        opened_oms: openedOms.value,
        executed_cas: executedCas.value,
        offers: offers.value,
        // Legacy generic (kept for back-compat)
        views: legacyViews,
        saves: saves.value,
        inquiries: inquiries.value,
        downloads: openedOms.value,
        nda_executions: executedCas.value,
      },
      raw: {
        title: document.title,
        url: window.location.href,
        scraped_dom_at: new Date().toISOString(),
        matched_labels: {
          impressions: impressions.foundLabel,
          page_views: pageViews.foundLabel,
          unique_visitors: uniqueVisitors.foundLabel,
          opened_oms: openedOms.foundLabel,
          executed_cas: executedCas.foundLabel,
          offers: offers.foundLabel,
          saves: saves.foundLabel,
          inquiries: inquiries.foundLabel,
        },
        candidates,
      },
    };
  }

  async function syncToCrm(payload) {
    const cfg = await chrome.storage.local.get(["crmUrl", "apiKey"]);
    const url = (cfg.crmUrl || "https://stewardship-crm.netlify.app").replace(/\/+$/, "");
    if (!cfg.apiKey) return { ok: false, error: "API key not set" };

    const res = await fetch(`${url}/api/extension/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-extension-key": cfg.apiKey },
      body: JSON.stringify({ source: "crexi", ...payload }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body?.error || `HTTP ${res.status}`, hint: body?.hint };
    return { ok: true, ...body };
  }

  // Listen to popup "sync" requests
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.action !== "sync") return;
    (async () => {
      const data = await scrape();
      if (!data) {
        sendResponse({ ok: false, error: "Couldn't find a CREXi listing ID on this page." });
        return;
      }
      const result = await syncToCrm(data);
      // Pass debug info back so the popup can show what we found on this
      // page if the metrics came back zero. Helps tune label keywords.
      sendResponse({ ...result, scrapedDebug: data.raw });
    })();
    return true; // keep channel open for async response
  });

  // ── Auto-sync on page load if last sync >6h ago for this listing ─────────
  (async () => {
    const id = extractListingId();
    if (!id) return;
    const lastKey = `crexi_last_${id}`;
    const last = await chrome.storage.local.get([lastKey]);
    const lastTime = last[lastKey] || 0;
    if (Date.now() - lastTime > AUTO_SYNC_AFTER_MS) {
      // Wait a couple seconds for SPA hydration before scraping (scrape itself
      // also polls up to 6s for KPIs to render, but giving it a head start
      // means manual + auto syncs both land cleanly).
      setTimeout(async () => {
        const data = await scrape();
        if (data) {
          const r = await syncToCrm(data);
          if (r.ok) await chrome.storage.local.set({ [lastKey]: Date.now() });
        }
      }, 3500);
    }
  })();
})();
