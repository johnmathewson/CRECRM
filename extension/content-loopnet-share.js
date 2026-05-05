/**
 * CoStar / LoopNet "Listing Performance Report" share page scraper.
 *
 * Runs on:
 *   https://listingmanager.costar.com/listingperformancereport/*
 *   https://listingmanager.costar.com/listing/*
 *
 * The share-report page is a CoStar SPA that fetches metrics via XHR after
 * page load, then renders them into <div class="stats-value"> tiles paired
 * with <div class="stats-label"> labels. Six-ish KPIs typically:
 *   - Total Views (Impressions)
 *   - Total Detail Page Views
 *   - Visitors
 *   - Inquiries (combined Email + Phone)
 *   - Saved
 *   - Searches Appeared
 *
 * The page works with no login (the share-token is the auth), so any time
 * John has it open in his browser he can hit the popup's Sync button to
 * push fresh numbers to the owner dashboard.
 *
 * Also auto-fires once per page-visit if the metrics haven't been pushed in
 * the last 6 hours.
 */

(function () {
  const AUTO_SYNC_AFTER_MS = 6 * 60 * 60_000;

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  async function waitFor(test, { maxMs = 12000, intervalMs = 250 } = {}) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const v = test();
      if (v) return v;
      await sleep(intervalMs);
    }
    return null;
  }

  // ── Listing identity ────────────────────────────────────────────────────
  // The listing manager URL doesn't expose the numeric LoopNet listing ID
  // in the path. We use the share-token from the URL as our external_id, OR
  // try to scrape the listing's address from the rendered page header.
  function extractIdentity() {
    const path = window.location.pathname;
    // Path shape: /listingperformancereport/shared/<TOKEN> or /listing/<id>
    const shareMatch = path.match(/\/listingperformancereport\/shared\/([A-Za-z0-9_=+/-]+)/);
    if (shareMatch) {
      return {
        kind: "share_token",
        external_listing_id: `share:${shareMatch[1].slice(0, 20)}`, // truncate so it's index-friendly
        share_url: window.location.href.split("?")[0],
        share_token: shareMatch[1],
      };
    }
    const listingMatch = path.match(/\/listing\/([A-Za-z0-9_-]+)/);
    if (listingMatch) {
      return {
        kind: "listing_id",
        external_listing_id: listingMatch[1],
        share_url: null,
        share_token: null,
      };
    }
    return null;
  }

  // ── Metric extraction ──────────────────────────────────────────────────
  //
  // CoStar pairs <div class="stats-value">N</div> tiles with adjacent
  // <div class="stats-label">…label HTML…</div>. The label HTML often
  // contains nested elements (icon + tooltip + visible text), so we use
  // textContent for matching.
  //
  // Mapping CoStar labels → CRM listing_metrics columns:
  //   "Total Views" / "Impressions"            → impressions
  //   "Total Detail Page Views" / "Page Views" → page_views (also legacy `views`)
  //   "Visitors"                               → unique_visitors
  //   "Inquiries" / "Email"+"Phone Inquiries"  → inquiries
  //   "Saved"                                  → saves
  //   "Searches" / "Appeared in Searches"      → (no column yet — keep raw)

  function findTileNumber(labelKeywords, root = document) {
    // Strategy 1: pair stats-value + stats-label by DOM proximity. Walk
    // every .stats-value, then look for the nearest .stats-label sibling
    // (within 2 ancestors).
    const values = Array.from(root.querySelectorAll(".stats-value, [class*='stats-value']"));
    for (const valEl of values) {
      let cursor = valEl.parentElement;
      for (let depth = 0; depth < 3 && cursor; depth++) {
        const labelEl = cursor.querySelector(".stats-label, [class*='stats-label']");
        if (labelEl) {
          const labelText = (labelEl.textContent || "").toLowerCase();
          if (labelKeywords.some((k) => labelText.includes(k))) {
            const valStr = (valEl.textContent || "").trim().replace(/,/g, "");
            const num = parseInt(valStr, 10);
            return Number.isNaN(num) ? null : num;
          }
          break; // found a label but didn't match — don't keep walking
        }
        cursor = cursor.parentElement;
      }
    }
    return null;
  }

  function scrapeAllStatTiles() {
    const tiles = [];
    const values = Array.from(document.querySelectorAll(".stats-value, [class*='stats-value']"));
    for (const valEl of values) {
      let cursor = valEl.parentElement;
      let labelEl = null;
      for (let depth = 0; depth < 3 && cursor && !labelEl; depth++) {
        labelEl = cursor.querySelector(".stats-label, [class*='stats-label']");
        cursor = cursor.parentElement;
      }
      const valText = (valEl.textContent || "").trim();
      const labelText = labelEl ? (labelEl.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80) : "(no label)";
      tiles.push({ value: valText, label: labelText });
    }
    return tiles;
  }

  function pageDiagnostic() {
    return {
      doc_url: window.location.href,
      doc_title: document.title,
      doc_state: document.readyState,
      counts: {
        stats_value: document.querySelectorAll(".stats-value, [class*='stats-value']").length,
        stats_label: document.querySelectorAll(".stats-label, [class*='stats-label']").length,
        all_elements: document.querySelectorAll("*").length,
      },
      tiles: scrapeAllStatTiles().slice(0, 12),
      body_text_sample: document.body.textContent.replace(/\s+/g, " ").slice(0, 400),
    };
  }

  async function scrape() {
    const identity = extractIdentity();
    if (!identity) return null;

    // Wait for the SPA's data XHR to populate at least one stats tile with
    // a non-empty value. The shell renders empty 0 placeholders before
    // the API responds — we want to wait for the real data to land.
    await waitFor(() => {
      const tiles = scrapeAllStatTiles();
      // Look for at least 3 tiles where the value is digits (any digits,
      // including 0) AND the corresponding label is non-empty
      return tiles.filter((t) => /^\d/.test(t.value) && t.label !== "(no label)").length >= 3;
    }, { maxMs: 12000 });

    const tiles = scrapeAllStatTiles();

    const impressions = findTileNumber([
      "total views", "impressions", "appeared in searches",
    ]);
    const pageViews = findTileNumber([
      "total detail page views", "detail page views", "page views",
    ]);
    const visitors = findTileNumber([
      "visitors", "unique visitors",
    ]);
    const inquiries = findTileNumber([
      "inquiries", "leads", "contacts",
    ]);
    const saves = findTileNumber([
      "saved", "saves", "favorites",
    ]);

    // Legacy "views" gets the most useful single value
    const legacyViews = pageViews ?? visitors ?? impressions ?? null;

    return {
      external_listing_id: identity.external_listing_id,
      external_url: identity.share_url || window.location.href.split("?")[0],
      metrics: {
        // CREXi-native fields the API understands (LoopNet maps to same shape)
        impressions: impressions ?? 0,
        page_views: pageViews ?? 0,
        unique_visitors: visitors ?? 0,
        // Legacy generic
        views: legacyViews ?? 0,
        saves: saves ?? 0,
        inquiries: inquiries ?? 0,
      },
      raw: {
        title: document.title,
        url: window.location.href,
        scraped_dom_at: new Date().toISOString(),
        identity_kind: identity.kind,
        all_tiles: tiles,
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
      body: JSON.stringify({ source: "loopnet", ...payload }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body?.error || `HTTP ${res.status}`, hint: body?.hint };
    return { ok: true, ...body };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.action !== "sync") return;
    (async () => {
      const data = await scrape();
      if (!data) {
        sendResponse({
          ok: false,
          error: "Couldn't find a LoopNet/CoStar listing on this page.",
        });
        return;
      }
      const result = await syncToCrm(data);
      sendResponse({ ...result, scrapedDebug: { ...data.raw, diagnostic: pageDiagnostic() } });
    })();
    return true;
  });

  // Auto-sync if last sync >6h ago
  (async () => {
    const identity = extractIdentity();
    if (!identity) return;
    const lastKey = `loopnet_share_last_${identity.external_listing_id}`;
    const last = await chrome.storage.local.get([lastKey]);
    if (Date.now() - (last[lastKey] || 0) > AUTO_SYNC_AFTER_MS) {
      setTimeout(async () => {
        const data = await scrape();
        if (data) {
          const r = await syncToCrm(data);
          if (r.ok) await chrome.storage.local.set({ [lastKey]: Date.now() });
        }
      }, 4500); // give the SPA's data XHR a head start
    }
  })();
})();
