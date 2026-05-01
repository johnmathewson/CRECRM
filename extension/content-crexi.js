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
    // CREXi listing URLs look like: /properties/12345/state-city-name
    const m = window.location.pathname.match(/\/properties\/(\d+)/);
    return m ? m[1] : null;
  }

  // ── Metric extraction ────────────────────────────────────────────────────
  // Walks the DOM looking for labeled stat cards. Robust to layout changes
  // because we match by adjacent label text, not absolute selectors.
  function findMetricNear(labelKeywords) {
    const allText = Array.from(document.querySelectorAll("body *"))
      .filter((el) => el.children.length === 0 && el.textContent && el.textContent.trim().length < 40);

    for (const el of allText) {
      const txt = el.textContent.trim().toLowerCase();
      if (labelKeywords.some((kw) => txt === kw || txt.includes(kw))) {
        // Look up the DOM tree for a sibling/parent with a numeric value
        let cursor = el;
        for (let i = 0; i < 4; i++) {
          if (!cursor) break;
          const numericNode = Array.from(cursor.querySelectorAll("*"))
            .filter((n) => n.children.length === 0 && /^[\d,]+$/.test((n.textContent || "").trim()))
            .find((n) => n !== el);
          if (numericNode) {
            return parseInt(numericNode.textContent.replace(/,/g, ""), 10) || 0;
          }
          cursor = cursor.parentElement;
        }
      }
    }
    return 0;
  }

  function scrape() {
    const id = extractListingId();
    if (!id) return null;

    // Multiple keyword groups so we don't break if CREXi rephrases.
    const views = findMetricNear(["views", "page views", "impressions"]);
    const saves = findMetricNear(["saves", "saved", "watchlists"]);
    const inquiries = findMetricNear(["inquiries", "leads", "messages", "contacts"]);
    const downloads = findMetricNear(["downloads", "om downloads", "documents downloaded"]);

    return {
      external_listing_id: id,
      external_url: window.location.href.split("?")[0],
      metrics: { views, saves, inquiries, downloads },
      raw: {
        title: document.title,
        url: window.location.href,
        scraped_dom_at: new Date().toISOString(),
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
    if (!res.ok) return { ok: false, error: body?.error || `HTTP ${res.status}` };
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
      sendResponse(result);
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
