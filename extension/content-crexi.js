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

  function scrape() {
    const id = extractListingId();
    if (!id) return null;

    // CREXi seller dashboard labels (verified live April 2026):
    //   "Leads" → inquiries (warm — buyer asked a question)
    //   "Opened OMs" → downloads (engaged — opened the OM)
    //   "Executed CAs" → nda_executions (serious — signed NDA)
    //   "Offers" → offers (real money on the table)
    // Views/saves typically don't show on this dashboard view — left in
    // case they appear on other CREXi surfaces (e.g. listing-detail public).
    const candidates = collectAllLabeledNumbers();
    const views = findMetricByLabel(candidates, [
      "views", "page views", "listing views", "total views",
      "30 day views", "30-day views", "impressions",
    ]);
    const saves = findMetricByLabel(candidates, [
      "saves", "saved", "watchlists", "watchlist", "favorites",
    ]);
    const inquiries = findMetricByLabel(candidates, [
      "leads", "inquiries", "messages", "contacts", "lead submissions",
    ]);
    const downloads = findMetricByLabel(candidates, [
      "opened oms", "om downloads", "downloads",
      "documents downloaded", "document downloads", "brochure downloads",
    ]);
    const ndaExecutions = findMetricByLabel(candidates, [
      "executed cas", "executed ca", "ca executions",
      "ndas signed", "nda signatures", "executed ndas",
    ]);
    const offers = findMetricByLabel(candidates, ["offers", "offers received"]);

    return {
      external_listing_id: id,
      external_url: window.location.href.split("?")[0],
      metrics: {
        views: views.value,
        saves: saves.value,
        inquiries: inquiries.value,
        downloads: downloads.value,
        nda_executions: ndaExecutions.value,
        offers: offers.value,
      },
      raw: {
        title: document.title,
        url: window.location.href,
        scraped_dom_at: new Date().toISOString(),
        matched_labels: {
          views: views.foundLabel,
          saves: saves.foundLabel,
          inquiries: inquiries.foundLabel,
          downloads: downloads.foundLabel,
          nda_executions: ndaExecutions.foundLabel,
          offers: offers.foundLabel,
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
      const data = scrape();
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
      // Wait a couple seconds for SPA hydration before scraping
      setTimeout(async () => {
        const data = scrape();
        if (data) {
          const r = await syncToCrm(data);
          if (r.ok) await chrome.storage.local.set({ [lastKey]: Date.now() });
        }
      }, 3500);
    }
  })();
})();
