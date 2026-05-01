/**
 * LoopNet content script — runs on loopnet.com listing pages.
 *
 * LoopNet's owner-facing analytics live on a separate "My Listings" dashboard
 * but views/leads also surface on listing detail when authenticated. Same
 * heuristic-based scraping approach as CREXi — match by adjacent label text.
 */

(function () {
  const AUTO_SYNC_AFTER_MS = 6 * 60 * 60_000;

  function extractListingId() {
    // LoopNet URLs: /Listing/<address>/<id>/  or  /Listing/<id>/...
    const path = window.location.pathname;
    const numericTrailing = path.match(/\/(\d{6,})(?:[\/?#]|$)/);
    if (numericTrailing) return numericTrailing[1];
    // Fallback: any 6+ digit run in the URL
    const anywhere = path.match(/(\d{6,})/);
    return anywhere ? anywhere[1] : null;
  }

  function findMetricNear(labelKeywords) {
    const allText = Array.from(document.querySelectorAll("body *"))
      .filter((el) => el.children.length === 0 && el.textContent && el.textContent.trim().length < 40);

    for (const el of allText) {
      const txt = el.textContent.trim().toLowerCase();
      if (labelKeywords.some((kw) => txt === kw || txt.includes(kw))) {
        let cursor = el;
        for (let i = 0; i < 4; i++) {
          if (!cursor) break;
          const numericNode = Array.from(cursor.querySelectorAll("*"))
            .filter((n) => n.children.length === 0 && /^[\d,]+$/.test((n.textContent || "").trim()))
            .find((n) => n !== el);
          if (numericNode) return parseInt(numericNode.textContent.replace(/,/g, ""), 10) || 0;
          cursor = cursor.parentElement;
        }
      }
    }
    return 0;
  }

  function scrape() {
    const id = extractListingId();
    if (!id) return null;

    const views = findMetricNear(["views", "listing views", "page views"]);
    const saves = findMetricNear(["saves", "favorites", "saved"]);
    const inquiries = findMetricNear(["leads", "inquiries", "contacts", "messages"]);
    const downloads = findMetricNear(["downloads", "documents", "package downloads"]);

    return {
      external_listing_id: id,
      external_url: window.location.href.split("?")[0],
      metrics: { views, saves, inquiries, downloads },
      raw: { title: document.title, url: window.location.href, scraped_dom_at: new Date().toISOString() },
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
    if (!res.ok) return { ok: false, error: body?.error || `HTTP ${res.status}` };
    return { ok: true, ...body };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.action !== "sync") return;
    (async () => {
      const data = scrape();
      if (!data) {
        sendResponse({ ok: false, error: "Couldn't find a LoopNet listing ID on this page." });
        return;
      }
      const result = await syncToCrm(data);
      sendResponse(result);
    })();
    return true;
  });

  // Auto-sync on page load
  (async () => {
    const id = extractListingId();
    if (!id) return;
    const lastKey = `loopnet_last_${id}`;
    const last = await chrome.storage.local.get([lastKey]);
    if (Date.now() - (last[lastKey] || 0) > AUTO_SYNC_AFTER_MS) {
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
