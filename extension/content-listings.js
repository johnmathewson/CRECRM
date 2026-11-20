/**
 * Listing-watch content script — runs on CREXi and LoopNet SEARCH pages.
 *
 * Captures the listing cards on a search results page (e.g. "Hobart, IN —
 * for sale") and posts them to the CRM at /api/extension/listings. The
 * background worker opens these pages once a day in a background tab with
 * `#stw-capture` in the URL, which makes this script run automatically;
 * it also responds to a {action:"capture-listings"} message for manual runs.
 *
 * DOM shapes verified 2026-11-19:
 *   CREXi   a.cui-card-link[href*="/properties/<id>/"] inside a div.ctw:grid card;
 *           leaves: "For Sale"/"For Lease", price (text-heading-6), name,
 *           description, street, "City, ST 46342" (ctw:text-text-secondary).
 *           Results live in a div.ctw:overflow-auto that lazy-loads on scroll.
 *   LoopNet article.placard-card[data-lk=<id>] with data-automation-city /
 *           -transaction-type / -property-type, .building-name,
 *           p.placard-address, "$306,000", "38.29 AC", .broker-name/.broker-company.
 */

(function () {
  const HOST = location.hostname;
  const IS_CREXI = /crexi\.com$/.test(HOST);
  const IS_LOOPNET = /loopnet\.com$/.test(HOST);
  if (!IS_CREXI && !IS_LOOPNET) return;

  const leafText = (root) =>
    Array.from(root.querySelectorAll("*"))
      .filter((e) => e.children.length === 0 && e.textContent && e.textContent.trim())
      .map((e) => ({ el: e, cls: String(e.className || ""), t: e.textContent.trim() }));

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** First real listing photo in a card: skip broker logos, icons, data: URIs. */
  function cardPhoto(card) {
    const imgs = Array.from(card.querySelectorAll("img"));
    for (const img of imgs) {
      const cls = String(img.className || "");
      if (/logo|icon|avatar|badge/i.test(cls) || /logo|icon/i.test(img.alt || "")) continue;
      const src = img.currentSrc || img.getAttribute("src") || img.getAttribute("data-src") || "";
      if (!/^https:\/\//.test(src) || /\.svg(\?|$)/i.test(src) || /user-accounts|broker/i.test(src)) continue;
      if (img.naturalWidth && img.naturalWidth < 80) continue;
      return src;
    }
    const bg = card.querySelector('[style*="background-image"]');
    const m = bg && bg.getAttribute("style").match(/url\(["']?(https:[^"')]+)/);
    return m ? m[1] : null;
  }

  // ── CREXi ────────────────────────────────────────────────────────────────
  function crexiTotal() {
    const m = document.body.innerText.match(/([\d,]+)\s+propert(?:y|ies)/i);
    return m ? parseInt(m[1].replace(/,/g, ""), 10) : null;
  }
  /**
   * CREXi virtualizes the results list: only ~8 cards exist in the DOM at
   * once, so we step the scroller down and PARSE AT EACH STEP, accumulating
   * by listing id, until the scroller stops moving or we have the stated total.
   */
  async function crexiLoadAll(cityFilter) {
    const total = crexiTotal();
    // The results column is the TALLEST scrollable element holding cards
    // (inner card carousels also report overflow:auto but don't scroll).
    const scroller = Array.from(document.querySelectorAll("div"))
      .filter((e) => {
        const s = getComputedStyle(e);
        return (s.overflowY === "auto" || s.overflowY === "scroll") && e.scrollHeight > e.clientHeight + 50 && e.querySelector("a.cui-card-link");
      })
      .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    const acc = new Map();
    const take = () => { for (const l of crexiParse(null)) if (!acc.has(l.external_id)) acc.set(l.external_id, l); };
    take();
    let lastTop = -1;
    for (let i = 0; i < 120; i++) {
      if (total && acc.size >= total) break;
      if (scroller) scroller.scrollTop += scroller.clientHeight * 0.8; else window.scrollBy(0, 600);
      await sleep(700);
      take();
      const top = scroller ? scroller.scrollTop : window.scrollY;
      if (top === lastTop) { await sleep(1200); take(); if ((scroller ? scroller.scrollTop : window.scrollY) === lastTop) break; }
      lastTop = top;
    }
    const all = Array.from(acc.values());
    const kept = cityFilter ? all.filter((l) => l.raw.city && l.raw.city.toLowerCase().startsWith(cityFilter.toLowerCase())) : all;
    return { total, loaded: all.length, listings: kept };
  }
  function crexiParse(cityFilter) {
    const seen = new Set(); const out = [];
    for (const a of document.querySelectorAll('a.cui-card-link[href*="/properties/"]')) {
      const href = a.getAttribute("href") || "";
      const id = (href.match(/\/properties\/(\d+)/) || [])[1];
      if (!id || seen.has(id)) continue;
      const card = a.closest('[class*="ctw:grid"]') || a.parentElement?.parentElement?.parentElement?.parentElement || a;
      // The photo carousel sits beside the text grid inside the <cui-card>.
      const outer = a.closest("cui-card") || card.parentElement || card;
      const leaves = leafText(card);
      const label = leaves.find((l) => /^For (Sale|Lease)$/i.test(l.t));
      const price = leaves.find((l) => /text-heading/.test(l.cls) || /^(\$[\d,.]+|Unpriced|Auction|Call for)/i.test(l.t));
      const cityLeaf = leaves.find((l) => /text-text-secondary/.test(l.cls) && /,\s*[A-Z]{2}\s*\d{5}/.test(l.t)) || leaves.find((l) => /,\s*[A-Z]{2}\s*\d{5}$/.test(l.t));
      const cityIdx = cityLeaf ? leaves.indexOf(cityLeaf) : -1;
      const street = cityIdx > 0 ? leaves[cityIdx - 1].t : null;
      const titles = leaves.filter((l) => /overflow-hidden/.test(l.cls)).map((l) => l.t);
      const details = leaves.find((l) => /SqFt|\bSF\b|\bAC\b|Acres|CAP/i.test(l.t) && l !== price);
      const city = cityLeaf ? cityLeaf.t : null;
      if (cityFilter && city && !city.toLowerCase().startsWith(cityFilter.toLowerCase())) continue;
      seen.add(id);
      out.push({
        external_id: id,
        url: "https://www.crexi.com" + href.split("?")[0],
        title: titles[0] || null,
        address: street && city ? `${street}, ${city}` : street || city,
        price_text: price ? price.t : null,
        asset_type: details ? details.t.split("|")[0].trim() : null,
        photo_url: outer.querySelector("img.slide-content-img")?.getAttribute("src") || cardPhoto(outer),
        kind: label ? (/lease/i.test(label.t) ? "lease" : "sale") : null,
        raw: { label: label?.t, details: details?.t, description: titles[1] || null, city },
      });
    }
    return out;
  }

  // ── LoopNet ──────────────────────────────────────────────────────────────
  function loopnetParse(cityFilter) {
    const out = [];
    for (const art of document.querySelectorAll("article.placard-card")) {
      const id = art.getAttribute("data-lk") || art.getAttribute("data-gtm-listing_id");
      const link = art.querySelector('a[href*="/Listing/"]');
      if (!id || !link) continue;
      const city = art.getAttribute("data-automation-city");
      if (cityFilter && city && city.toLowerCase() !== cityFilter.toLowerCase()) continue;
      const leaves = leafText(art);
      const price = leaves.find((l) => /^\$[\d,.]+/.test(l.t));
      const size = leaves.find((l) => /^[\d,.]+\s*(SF|AC)\b/i.test(l.t));
      const txn = art.getAttribute("data-automation-transaction-type") || "";
      const title = art.querySelector(".building-name")?.textContent.trim() || null;
      let address = art.querySelector(".placard-address")?.textContent.trim() || null;
      // LoopNet sometimes puts the street in the title and only "Hobart, IN 46342" in the address line.
      if (address && !/^\d/.test(address) && title && /^\d+\s/.test(title)) address = `${title}, ${address}`;
      out.push({
        external_id: id,
        url: link.getAttribute("href").split("?")[0],
        title,
        address,
        price_text: price ? price.t : null,
        sqft: size && /SF/i.test(size.t) ? parseInt(size.t.replace(/[^\d]/g, ""), 10) : null,
        acres: size && /AC/i.test(size.t) ? parseFloat(size.t.replace(/[^\d.]/g, "")) : null,
        asset_type: art.getAttribute("data-automation-property-type") || null,
        broker_name: art.querySelector(".broker-name")?.textContent.trim() || null,
        broker_company: art.querySelector(".broker-company")?.textContent.trim() || null,
        photo_url: art.querySelector("img.embla__slide__img")?.getAttribute("src") || cardPhoto(art),
        kind: /lease/i.test(txn) ? "lease" : /sale/i.test(txn) ? "sale" : null,
        raw: { listing_type: art.getAttribute("data-automation-listing-type"), city, state: art.getAttribute("data-automation-state") },
      });
    }
    return out;
  }

  // ── Capture + post ───────────────────────────────────────────────────────
  async function capture(opts = {}) {
    const cfg = await chrome.storage.local.get(["crmUrl", "apiKey", "listingsCity"]);
    const crm = (cfg.crmUrl || "https://stewardship-crm.netlify.app").replace(/\/+$/, "");
    const city = opts.city || cfg.listingsCity || "Hobart";
    if (!cfg.apiKey) return { ok: false, error: "No API key configured" };

    // Wait for cards to exist (SPA render), up to ~20s.
    for (let i = 0; i < 40; i++) {
      if (document.querySelector(IS_CREXI ? "a.cui-card-link" : "article.placard-card")) break;
      await sleep(500);
    }
    let loadInfo = null, listings;
    if (IS_CREXI) { const r = await crexiLoadAll(city); loadInfo = { total: r.total, loaded: r.loaded }; listings = r.listings; }
    else listings = loopnetParse(city);

    const kindFromUrl = /lease/i.test(location.href) ? "lease" : "sale";
    const kind = listings.find((l) => l.kind)?.kind || kindFromUrl;
    const complete = IS_CREXI ? !!(loadInfo && (!loadInfo.total || loadInfo.loaded >= loadInfo.total)) : !document.querySelector('a[aria-label*="Next" i], .paging a.next');
    const payload = {
      source: IS_CREXI ? "crexi" : "loopnet", kind, city,
      search_url: location.href.replace(/#.*$/, ""), complete,
      listings: listings.map((l) => ({ ...l, kind: undefined })),
    };
    let result;
    try {
      const res = await fetch(`${crm}/api/extension/listings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-extension-key": cfg.apiKey },
        body: JSON.stringify(payload),
      });
      result = { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
    } catch (err) {
      result = { ok: false, error: String(err) };
    }
    const summary = { ...result, source: payload.source, kind, city, captured: listings.length, complete, loadInfo, url: payload.search_url };
    try { chrome.runtime.sendMessage({ type: "stw-listings-done", summary }); } catch {}
    return summary;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.action === "capture-listings") {
      capture(msg).then(sendResponse).catch((e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    }
  });

  if (/stw-capture/.test(location.hash)) {
    // Opened by the daily alarm: give the SPA a moment, then capture.
    sleep(IS_CREXI ? 4000 : 2000).then(() => capture());
  }
})();
