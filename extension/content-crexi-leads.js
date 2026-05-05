/**
 * CREXi leads-page scraper.
 *
 * Runs on:
 *   https://www.crexi.com/property/<id>/dashboard/leads*
 *
 * Pipeline:
 *   1. Wait for the leads table to render (rows with name + phone visible).
 *   2. Read every row → extract name, phone, company, role, visit count,
 *      level_of_interest (= "Listing Activity" column).
 *   3. Fetch prior state from the background worker (cached per-property)
 *      to decide which rows need a "deep scrape" (click row → read side
 *      panel → email + activity timeline). Deep-scrape rule:
 *        - new lead we've never seen, OR
 *        - level_of_interest moved up the funnel, OR
 *        - email is missing in cache, OR
 *        - first poll on this property in the current session
 *   4. Click each "needs deep scrape" row, wait for the side panel to
 *      populate, scrape email + timeline, close the panel, move on.
 *   5. POST the whole batch to /api/extension/crexi-leads.
 *
 * Triggered by:
 *   - chrome.runtime.onMessage with action === "scrape-leads" (background
 *     worker fires this after opening the hidden tab)
 *   - URL navigation (auto-fires once per page load if Chrome opens the
 *     dashboard tab manually too — useful for live debugging)
 */

(function () {
  // ── Listing ID from URL ─────────────────────────────────────────────────
  function getListingId() {
    const m = window.location.pathname.match(/\/property\/(\d+)\/dashboard\/leads/);
    return m ? m[1] : null;
  }

  // ── Wait helpers ────────────────────────────────────────────────────────
  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function waitFor(test, { maxMs = 8000, intervalMs = 150 } = {}) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const v = test();
      if (v) return v;
      await sleep(intervalMs);
    }
    return null;
  }

  // ── Table row scraping ─────────────────────────────────────────────────
  // Strategy: anchor on PHONE NUMBERS, not table tags. CREXi's leads page
  // uses Angular Material's mat-table which renders <mat-row> / [role=row]
  // instead of plain <tr>, so a tr-based scraper finds nothing. But every
  // lead row contains exactly one phone in "###.###.####" format. We:
  //
  //   1. Find every leaf element whose trimmed text exactly matches that
  //      phone format (these are the phone cells).
  //   2. Walk UP from each phone cell to find the row container — defined
  //      as the nearest ancestor that's either a [role=row], <tr>, <mat-row>,
  //      <cdk-row>, OR an ancestor whose textContent length jumps by >50%
  //      compared to its child (heuristic for "this is the row, not the cell").
  //   3. Extract name, company, role, visits, status, date FROM the row's
  //      textContent + any clickable child elements (for the click target).
  //
  // This works regardless of whether CREXi uses <table>, <mat-table>, or
  // pure-div layout.

  const FUNNEL_LABELS = [
    "Executed CA",
    "Downloaded DD",
    "Opened OM",
    "Opened Flyer",
    "Requested Info",
    "Calculated Valuation",
    "Clicked Phone",
    "Clicked Email",
    "Printed Page",
    "Saved Property",
    "Visited Page",
  ];

  const KNOWN_ROLES = [
    "BUYER REP",
    "TENANT REP",
    "LISTING REP",
    "LANDLORD REP",
    "PRINCIPAL INVESTOR",
    "PRIVATE INVESTOR",
    "PROPERTY MANAGER",
    "REIT",
    "COORDINATOR/ADMIN",
  ];

  function findRowContainer(phoneEl) {
    // Walk up to find a "row-like" ancestor. Stop at body.
    let cursor = phoneEl;
    for (let i = 0; i < 8; i++) {
      cursor = cursor.parentElement;
      if (!cursor || cursor === document.body) return null;
      const tag = cursor.tagName?.toLowerCase() || "";
      const role = cursor.getAttribute?.("role") || "";
      if (
        role === "row" ||
        tag === "tr" ||
        tag === "mat-row" ||
        tag === "cdk-row" ||
        cursor.classList?.contains("mat-row") ||
        cursor.classList?.contains("mat-mdc-row") ||
        cursor.classList?.contains("cdk-row")
      ) {
        return cursor;
      }
    }
    // No semantic row found — fall back to a "stable container" heuristic:
    // walk up until we find an ancestor whose textContent contains the
    // phone AND is short enough to be a row (< 600 chars), preferring the
    // most-direct ancestor.
    cursor = phoneEl.parentElement;
    let best = null;
    for (let i = 0; i < 8 && cursor; i++) {
      const text = (cursor.textContent || "").trim();
      if (text.length > 30 && text.length < 600) {
        best = cursor;
      } else if (best && text.length >= 600) {
        break;
      }
      cursor = cursor.parentElement;
    }
    return best;
  }

  function parseRow(rowEl, phone) {
    const fullText = (rowEl.textContent || "").trim();
    if (!fullText || fullText.toLowerCase().includes("number of visits")) {
      return null; // Header
    }

    // Name — first capitalized token-rich text leaf that isn't the phone
    // and isn't initials/funnel/role/CTA. Walk leaf nodes in DOM order.
    let name = "";
    const leafCandidates = Array.from(rowEl.querySelectorAll("*"))
      .filter(
        (n) =>
          n.children.length === 0 &&
          n.textContent &&
          n.textContent.trim().length > 0
      )
      .map((n) => n.textContent.trim());

    for (const text of leafCandidates) {
      if (!text || text === phone) continue;
      if (text.length < 3 || text.length > 80) continue;
      if (/^\d/.test(text)) continue; // skip numbers / phone
      if (/^[A-Z]{2,3}$/.test(text)) continue; // skip avatar initials like "JG"
      if (/contact lead/i.test(text)) continue;
      if (/^\d+\s+visits?$/i.test(text)) continue;
      if (FUNNEL_LABELS.some((l) => text === l)) continue;
      if (KNOWN_ROLES.some((r) => text.toUpperCase() === r)) continue;
      // Skip if it's a date ("May 04, 2026")
      if (/^[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}$/.test(text)) continue;
      // Looks name-shaped: at least one space OR mixed case
      if (text.includes(" ") || /^[A-Z][a-z]/.test(text)) {
        name = text;
        break;
      }
    }
    if (!name) return null;

    // Visits — "X visits" or "X visit"
    const visitsMatch = fullText.match(/(\d+)\s+visits?/i);
    const visits = visitsMatch ? parseInt(visitsMatch[1], 10) : null;

    // Funnel status — most-advanced label present in row text
    let levelOfInterest = null;
    for (const label of FUNNEL_LABELS) {
      if (fullText.includes(label)) {
        levelOfInterest = label;
        break;
      }
    }

    // Roles — uppercase pills
    const roles = [];
    for (const r of KNOWN_ROLES) {
      if (fullText.toUpperCase().includes(r)) roles.push(r);
    }

    // Company — first leaf that's not name/phone/role/funnel/visits/CTA
    let company = null;
    for (const text of leafCandidates) {
      if (!text || text === name || text === phone) continue;
      if (text.length < 3 || text.length > 80) continue;
      if (text.includes(phone)) continue;
      if (KNOWN_ROLES.some((r) => text.toUpperCase().includes(r))) continue;
      if (FUNNEL_LABELS.some((l) => text.includes(l))) continue;
      if (/^\d+\s+visits?$/i.test(text)) continue;
      if (/contact lead/i.test(text)) continue;
      if (/^\d/.test(text)) continue;
      if (/^[A-Z]{2,3}$/.test(text)) continue;
      if (/^[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}$/.test(text)) continue;
      // Skip if it's just the name we already captured
      if (text === name) continue;
      // Has to look company-like (mixed-case word OR multi-word)
      if (text.includes(" ") || /^[A-Z][a-z]/.test(text)) {
        company = text;
        break;
      }
    }

    // Date — "May 04, 2026" pattern
    const dateMatch = fullText.match(/([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})/);
    let lastActivityAt = null;
    const lastActivityLabel = dateMatch ? dateMatch[1] : null;
    if (dateMatch) {
      const parsed = new Date(dateMatch[1]);
      if (!Number.isNaN(parsed.getTime())) {
        lastActivityAt = parsed.toISOString();
      }
    }

    return {
      rowEl,
      name,
      phone,
      company,
      role: roles.length > 0 ? roles.join(", ") : null,
      number_of_visits: visits,
      level_of_interest: levelOfInterest,
      last_activity_label: lastActivityLabel,
      last_activity_at: lastActivityAt,
    };
  }

  function readListView() {
    // Find all leaf elements whose text is exactly a phone number
    const phoneRegex = /^\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}$/;
    const phoneLeaves = Array.from(document.querySelectorAll("body *"))
      .filter(
        (n) =>
          n.children.length === 0 &&
          n.textContent &&
          phoneRegex.test(n.textContent.trim())
      );

    // De-dupe by row container
    const seenRows = new Set();
    const out = [];
    for (const phoneEl of phoneLeaves) {
      const phone = phoneEl.textContent.trim();
      const rowEl = findRowContainer(phoneEl);
      if (!rowEl || seenRows.has(rowEl)) continue;
      seenRows.add(rowEl);
      const parsed = parseRow(rowEl, phone);
      if (parsed) out.push(parsed);
    }
    return out;
  }

  // Snapshot of what's actually on the page — emitted when readListView
  // returns 0 so we can debug remotely without a real browser session.
  function pageDiagnostic() {
    return {
      url: window.location.href.split("?")[0],
      doc_state: document.readyState,
      counts: {
        tr: document.querySelectorAll("tr").length,
        td: document.querySelectorAll("td").length,
        role_row: document.querySelectorAll("[role=row]").length,
        role_gridcell: document.querySelectorAll("[role=gridcell]").length,
        mat_row: document.querySelectorAll("mat-row, .mat-row, .mat-mdc-row, cdk-row").length,
        mat_table: document.querySelectorAll("mat-table, .mat-table, .mat-mdc-table, cdk-table").length,
        any_table: document.querySelectorAll("table").length,
      },
      phones_detected: (document.body.textContent.match(/\d{3}\.\d{3}\.\d{4}/g) || []).slice(0, 8),
      phone_leaf_count: Array.from(document.querySelectorAll("body *")).filter(
        (n) =>
          n.children.length === 0 &&
          /^\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}$/.test((n.textContent || "").trim())
      ).length,
      body_text_sample: document.body.textContent.replace(/\s+/g, " ").slice(0, 500),
    };
  }

  // ── Side-panel scraping ────────────────────────────────────────────────
  // After clicking a row, CREXi slides in a panel from the right. It
  // contains the lead's full contact info + an activity timeline.

  async function scrapePanel(row) {
    // Find the most likely click target: the avatar circle or the name cell.
    // Clicking the row's "Contact Lead" link would open the messaging modal,
    // so we click the name area instead.
    const clickTargets = [
      row.querySelector("td:nth-child(2)"),
      row.querySelector("td:nth-child(3)"),
      row,
    ].filter(Boolean);

    const target = clickTargets[0];
    if (!target) return null;

    target.click();

    // Wait for the panel to populate. We look for an element containing both
    // "Phone:" or "Email:" labels (those appear in the About tab).
    const panel = await waitFor(
      () => {
        const candidates = document.querySelectorAll("aside, [class*='side-panel'], [class*='detail-panel']");
        for (const c of candidates) {
          const text = (c.textContent || "").toLowerCase();
          if ((text.includes("phone:") || text.includes("email:")) && text.length > 50) {
            return c;
          }
        }
        // Fallback: look for a recently-added overlay containing email-shaped text
        const overlays = document.querySelectorAll("[role='dialog'], [class*='drawer'], [class*='overlay']");
        for (const o of overlays) {
          const text = o.textContent || "";
          if (/\b[\w.+-]+@[\w.-]+\.\w{2,}\b/.test(text)) return o;
        }
        return null;
      },
      { maxMs: 4500 }
    );

    if (!panel) return null;

    const text = panel.textContent || "";
    const html = panel.innerHTML || "";

    // Email — capture the first email-shaped string
    const emailMatch = text.match(/\b[\w.+-]+@[\w.-]+\.\w{2,}\b/);

    // Activity timeline — extract action labels with their relative times
    const FUNNEL_LABELS = [
      "Executed CA",
      "Downloaded DD",
      "Opened OM",
      "Opened Flyer",
      "Requested Info",
      "Calculated Valuation",
      "Clicked Phone",
      "Clicked Email",
      "Printed Page",
      "Saved Property",
      "Visited Page",
    ];
    const timeline = [];
    for (const label of FUNNEL_LABELS) {
      // Look for occurrences of the label paired with a time-ago string nearby
      const pattern = new RegExp(
        `(${label})[^a-zA-Z]{0,80}?(\\d+\\s+(?:minute|hour|day|week|month|year)s?\\s+ago|just now|yesterday)`,
        "gi"
      );
      let m;
      while ((m = pattern.exec(text)) !== null) {
        timeline.push({ action: m[1], occurred_label: m[2] });
      }
    }

    // Buyer evaluation — capture the structured pairs ("Funds: $...", "1031: No", etc.)
    const evalFields = {};
    const evalKeys = [
      "Team Rank",
      "Funds",
      "Assets Under Mgmt",
      "Interested in Financing",
      "1031 Exchange",
      "Level of Interest",
    ];
    for (const k of evalKeys) {
      const re = new RegExp(`${k}\\s*:?\\s*([^\\n]{1,80})`, "i");
      const m = text.match(re);
      if (m) {
        const v = m[1].trim();
        // Skip empty placeholders like "Select Rank" or "Enter $ Amount"
        if (
          v &&
          !/select rank|enter \$ amount|enter value/i.test(v) &&
          v.length < 80
        ) {
          evalFields[k] = v;
        }
      }
    }

    // Try to close the panel — look for a close button (X icon)
    const closeBtn =
      panel.querySelector("[aria-label*='close' i], [class*='close-btn'], button[mat-icon-button]") ||
      document.querySelector("aside button[aria-label*='close' i]");
    if (closeBtn && typeof closeBtn.click === "function") {
      closeBtn.click();
      await sleep(250);
    } else {
      // Fallback: press Escape to dismiss
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27 }));
      await sleep(250);
    }

    return {
      email: emailMatch ? emailMatch[0] : null,
      activity_timeline: timeline,
      buyer_evaluation: Object.keys(evalFields).length > 0 ? evalFields : null,
      raw_panel_text_sample: text.slice(0, 400),
    };
  }

  // ── State diff helpers (decide which rows to deep-scrape) ──────────────

  const FUNNEL_RANK = {
    "saved property": 1,
    "visited page": 2,
    "printed page": 2,
    "clicked phone": 3,
    "clicked email": 3,
    "opened flyer": 4,
    "opened om": 5,
    "downloaded dd": 5,
    "requested info": 6,
    "executed ca": 7,
    "calculated valuation": 7,
  };

  function rankOf(s) {
    return s ? (FUNNEL_RANK[s.toLowerCase().trim()] ?? 0) : 0;
  }

  async function getCachedState(listingId) {
    const key = `crexi_leads_state_${listingId}`;
    const data = await chrome.storage.local.get([key]);
    return data[key] || {};
  }

  async function setCachedState(listingId, state) {
    const key = `crexi_leads_state_${listingId}`;
    await chrome.storage.local.set({ [key]: state });
  }

  function leadCacheKey(lead) {
    return `${lead.name.toLowerCase()}|${(lead.phone || "").replace(/\D/g, "")}`;
  }

  function shouldDeepScrape(lead, cached) {
    if (!cached) return true; // Never seen
    if (!cached.email) return true; // Still missing email
    const priorRank = rankOf(cached.level_of_interest);
    const currRank = rankOf(lead.level_of_interest);
    if (currRank > priorRank) return true;
    const priorVisits = cached.number_of_visits || 0;
    const currVisits = lead.number_of_visits || 0;
    if (currVisits > priorVisits) return true;
    return false;
  }

  // ── Main scrape orchestrator ───────────────────────────────────────────

  // In-progress guard — protects against the auto-fire IIFE and a background-
  // worker "scrape-leads" message racing each other on the first cycle.
  let _scrapePromise = null;
  function runScrape() {
    if (_scrapePromise) return _scrapePromise;
    _scrapePromise = _runScrapeInner().finally(() => {
      _scrapePromise = null;
    });
    return _scrapePromise;
  }

  async function _runScrapeInner() {
    const listingId = getListingId();
    if (!listingId) {
      return { ok: false, error: "Not on a CREXi leads-dashboard URL" };
    }

    // Wait for the table to render. We're patient — Angular Material data
    // tables sometimes take 8–15s to populate in a backgrounded tab where
    // Chrome throttles JS execution.
    await waitFor(
      () => readListView().length > 0,
      { maxMs: 15000 }
    );

    const listRows = readListView();
    if (listRows.length === 0) {
      // Return a diagnostic dump so the popup/server can see what was
      // actually on the page — almost always means selectors need tuning.
      const diag = pageDiagnostic();
      return {
        ok: true,
        listing_id: listingId,
        leads: [],
        leads_count: 0,
        note: "No leads detected — page diagnostic attached.",
        diagnostic: diag,
      };
    }

    const cached = await getCachedState(listingId);
    const enriched = [];

    for (const row of listRows) {
      const cacheKey = leadCacheKey(row);
      const priorCache = cached[cacheKey] || null;
      const baseLead = {
        name: row.name,
        phone: row.phone,
        company: row.company,
        role: row.role,
        number_of_visits: row.number_of_visits,
        level_of_interest: row.level_of_interest,
        last_activity_label: row.last_activity_label,
        last_activity_at: row.last_activity_at,
        email: priorCache?.email || null,
        activity_timeline: priorCache?.activity_timeline || null,
        buyer_evaluation: priorCache?.buyer_evaluation || null,
      };

      if (shouldDeepScrape(row, priorCache)) {
        try {
          const panel = await scrapePanel(row.rowEl);
          if (panel) {
            baseLead.email = panel.email || baseLead.email;
            baseLead.activity_timeline = panel.activity_timeline;
            baseLead.buyer_evaluation = panel.buyer_evaluation;
          }
        } catch (e) {
          // Log but keep going
          baseLead._panel_error = String(e?.message || e);
        }
        // Throttle so CREXi doesn't think we're hammering
        await sleep(900);
      }

      enriched.push(baseLead);
      // Update cache as we go
      cached[cacheKey] = {
        email: baseLead.email,
        level_of_interest: baseLead.level_of_interest,
        number_of_visits: baseLead.number_of_visits,
        activity_timeline: baseLead.activity_timeline,
        buyer_evaluation: baseLead.buyer_evaluation,
        last_seen_at: new Date().toISOString(),
      };
    }

    await setCachedState(listingId, cached);

    // POST to CRM
    const cfg = await chrome.storage.local.get(["crmUrl", "apiKey"]);
    if (!cfg.apiKey) {
      return { ok: false, error: "API key not set", leads: enriched };
    }
    const url = (cfg.crmUrl || "https://stewardship-crm.netlify.app").replace(/\/+$/, "");

    let result = null;
    try {
      const res = await fetch(`${url}/api/extension/crexi-leads`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-extension-key": cfg.apiKey,
        },
        body: JSON.stringify({
          source: "crexi",
          crexi_listing_id: listingId,
          scraped_at: new Date().toISOString(),
          leads: enriched.map(({ rowEl, ...rest }) => rest),
          raw: enriched.length === 0 ? { diagnostic: pageDiagnostic() } : undefined,
        }),
      });
      result = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          ok: false,
          error: result?.error || `HTTP ${res.status}`,
          listing_id: listingId,
          leads_count: enriched.length,
        };
      }
    } catch (err) {
      return {
        ok: false,
        error: String(err?.message || err),
        listing_id: listingId,
        leads_count: enriched.length,
      };
    }

    return {
      ok: true,
      listing_id: listingId,
      leads_count: enriched.length,
      result,
    };
  }

  // ── Message listener ───────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.action !== "scrape-leads") return;
    runScrape().then(sendResponse).catch((err) =>
      sendResponse({ ok: false, error: String(err?.message || err) })
    );
    return true; // async response
  });

  // ── Auto-fire on direct page visit ─────────────────────────────────────
  // If John lands on the leads page in his own session (not a hidden tab),
  // run the scrape after a short delay so it self-heals if he opens it.
  // Background-tab triggers will still go through the message listener.
  (async () => {
    if (!getListingId()) return;
    // Only auto-run if we haven't seen this URL in the last 5 min — avoids
    // double-firing when the background worker just opened this tab.
    const lastKey = `crexi_leads_last_auto_${getListingId()}`;
    const last = await chrome.storage.local.get([lastKey]);
    if (last[lastKey] && Date.now() - last[lastKey] < 5 * 60 * 1000) return;
    await sleep(3500);
    const result = await runScrape();
    if (result?.ok) {
      await chrome.storage.local.set({ [lastKey]: Date.now() });
    }
  })();
})();
