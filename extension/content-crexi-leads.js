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

    // Get all leaf text nodes IN DOM ORDER. CREXi's row layout is reliably:
    //   [avatar initials] [name] [phone] [Contact Lead CTA] [company] [roles...] [N visits] [activity]
    //
    // So we anchor on the phone's position: name is the LAST name-shaped
    // leaf BEFORE the phone, company is the first company-shaped leaf
    // AFTER the phone (skipping the CTA + role pills + visit/activity cells).
    const leafCandidates = Array.from(rowEl.querySelectorAll("*"))
      .filter(
        (n) =>
          n.children.length === 0 &&
          n.textContent &&
          n.textContent.trim().length > 0
      )
      .map((n) => n.textContent.trim());

    const phoneIdx = leafCandidates.indexOf(phone);
    if (phoneIdx === -1) {
      // Fallback: phone leaf not found exactly (maybe formatting differs).
      // Take last "name-shaped" leaf as a guess.
      // (Rare path; most rows hit the indexOf branch.)
    }
    const beforePhone = phoneIdx >= 0 ? leafCandidates.slice(0, phoneIdx) : leafCandidates;
    const afterPhone = phoneIdx >= 0 ? leafCandidates.slice(phoneIdx + 1) : [];

    function isNameShaped(text) {
      if (!text || text.length < 3 || text.length > 80) return false;
      if (/^\d/.test(text)) return false;
      if (/^[A-Z]{2,3}$/.test(text)) return false;       // avatar initials
      if (/contact lead/i.test(text)) return false;
      if (/^\d+\s+visits?$/i.test(text)) return false;
      if (FUNNEL_LABELS.some((l) => text === l)) return false;
      if (KNOWN_ROLES.some((r) => text.toUpperCase() === r)) return false;
      if (/^[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}$/.test(text)) return false;
      // Has to look name-shaped: space OR mixed case starting capital
      return text.includes(" ") || /^[A-Z][a-z]/.test(text);
    }

    // NAME = LAST name-shaped leaf before phone (closest to phone wins)
    let name = "";
    for (let i = beforePhone.length - 1; i >= 0; i--) {
      if (isNameShaped(beforePhone[i])) {
        name = beforePhone[i];
        break;
      }
    }
    if (!name) return null;

    const visitsMatch = fullText.match(/(\d+)\s+visits?/i);
    const visits = visitsMatch ? parseInt(visitsMatch[1], 10) : null;

    // Funnel status
    let levelOfInterest = null;
    for (const label of FUNNEL_LABELS) {
      if (fullText.includes(label)) {
        levelOfInterest = label;
        break;
      }
    }

    // Roles — uppercase pills present in row text
    const roles = [];
    for (const r of KNOWN_ROLES) {
      if (fullText.toUpperCase().includes(r)) roles.push(r);
    }

    // COMPANY = first valid leaf in afterPhone that isn't CTA/role/visits/activity
    let company = null;
    for (const text of afterPhone) {
      if (!text || text === name || text === phone) continue;
      if (text.length < 3 || text.length > 80) continue;
      if (/contact lead/i.test(text)) continue;
      if (KNOWN_ROLES.some((r) => text.toUpperCase().includes(r))) continue;
      if (FUNNEL_LABELS.some((l) => text === l || text.includes(l))) continue;
      if (/^\d+\s+visits?$/i.test(text)) continue;
      if (/^\d/.test(text)) continue;
      if (/^[A-Z]{2,3}$/.test(text)) continue;
      if (/^[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}$/.test(text)) continue;
      if (text.includes(" ") || /^[A-Z]/.test(text)) {
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

  function isNameShapedText(text) {
    if (!text || text.length < 3 || text.length > 80) return false;
    if (/^\d/.test(text)) return false;
    if (/^[A-Z]{2,3}$/.test(text)) return false;
    if (/contact lead/i.test(text)) return false;
    if (/^\d+\s+visits?$/i.test(text)) return false;
    if (FUNNEL_LABELS.some((l) => text === l)) return false;
    if (KNOWN_ROLES.some((r) => text.toUpperCase() === r)) return false;
    if (/^[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}$/.test(text)) return false;
    if (/grant access|listing rep|landlord rep|tenant rep|buyer rep/i.test(text)) return false;
    if (/^(new|unassigned|hot|warm|cold)$/i.test(text)) return false;
    return text.includes(" ") || /^[A-Z][a-z]/.test(text);
  }

  function readListView() {
    // CREXi uses Angular Material's sticky-column pattern. The leads table
    // renders TWO parallel [role="row"] elements per lead: a "name-row" in
    // the sticky-column layer (avatar + person name) and a "phone-row" in
    // the scrolling layer (phone, company, role, visits, status). We pair
    // them by DOM order — the rendering preserves order, so name-rows and
    // phone-rows interleave or stack predictably.

    const phoneRegex = /^\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}$/;
    const allRoleRows = Array.from(document.querySelectorAll('[role="row"]'));

    // Helper: extract leaf texts from a row element
    const leavesOf = (row) =>
      Array.from(row.querySelectorAll("*"))
        .filter((n) => n.children.length === 0 && (n.textContent || "").trim().length > 0)
        .map((n) => n.textContent.trim());

    const nameRows = [];   // rows that have a person-name leaf, no phone
    const phoneRows = [];  // rows that have a phone leaf

    for (const row of allRoleRows) {
      const fullText = (row.textContent || "").trim();
      // Skip header rows
      if (/number of visits|listing activity/i.test(fullText)) continue;
      // Skip empty / oversize rows
      if (fullText.length < 3 || fullText.length > 2000) continue;

      const leaves = leavesOf(row);
      const hasPhoneLeaf = leaves.some((t) => phoneRegex.test(t));

      if (hasPhoneLeaf) {
        phoneRows.push({ row, leaves, fullText });
      } else {
        // No phone — does it have a person-name leaf?
        const hasName = leaves.some((t) => isNameShapedText(t));
        if (hasName) {
          nameRows.push({ row, leaves, fullText });
        }
      }
    }

    // Pair name-rows with phone-rows by index. If counts don't match,
    // fall back to phone-row-only parsing (we'll have phone but no name
    // for those — better than nothing).
    const pairs = [];
    for (let i = 0; i < phoneRows.length; i++) {
      pairs.push({
        phoneRow: phoneRows[i],
        nameRow: nameRows[i] || null,
      });
    }

    const out = [];
    for (const { phoneRow, nameRow } of pairs) {
      const phoneLeaf = phoneRow.leaves.find((t) => phoneRegex.test(t));
      if (!phoneLeaf) continue;

      // Name from name-row (find first/best name-shaped leaf, prefer multi-word)
      let name = "";
      if (nameRow) {
        // Skip avatar initials, prefer first multi-word name
        const candidates = nameRow.leaves.filter((t) => isNameShapedText(t));
        // Prefer multi-word (full names) over single-word
        name = candidates.find((t) => t.includes(" ")) || candidates[0] || "";
      }
      if (!name) continue; // skip rows we can't name

      // Visits, funnel, roles from phone-row
      const visitsMatch = phoneRow.fullText.match(/(\d+)\s+visits?/i);
      const visits = visitsMatch ? parseInt(visitsMatch[1], 10) : null;

      let levelOfInterest = null;
      for (const label of FUNNEL_LABELS) {
        if (phoneRow.fullText.includes(label)) {
          levelOfInterest = label;
          break;
        }
      }

      // Roles — match against pills found in phone-row text (case-insensitive)
      const roles = [];
      const upperText = phoneRow.fullText.toUpperCase();
      for (const r of KNOWN_ROLES) {
        if (upperText.includes(r)) roles.push(r);
      }

      // Company — first company-shaped leaf in phone-row, after phone, before roles/funnel
      const phoneIdxInPhoneRow = phoneRow.leaves.indexOf(phoneLeaf);
      const afterPhone = phoneRow.leaves.slice(phoneIdxInPhoneRow + 1);
      let company = null;
      for (const t of afterPhone) {
        if (!t || t.length < 3 || t.length > 80) continue;
        if (/contact lead/i.test(t)) continue;
        if (KNOWN_ROLES.some((r) => t.toUpperCase().includes(r))) continue;
        if (FUNNEL_LABELS.some((l) => t === l || t.includes(l))) continue;
        if (/^\d+\s+visits?$/i.test(t)) continue;
        if (/^\d/.test(t)) continue;
        if (/^[A-Z]{2,3}$/.test(t)) continue;
        if (/^[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}$/.test(t)) continue;
        if (/^(new|unassigned)$/i.test(t)) continue;
        if (/grant access/i.test(t)) continue;
        if (t.includes(" ") || /^[A-Z]/.test(t)) {
          company = t;
          break;
        }
      }

      // Activity date
      const dateMatch = phoneRow.fullText.match(/([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})/);
      let lastActivityAt = null;
      const lastActivityLabel = dateMatch ? dateMatch[1] : null;
      if (dateMatch) {
        const parsed = new Date(dateMatch[1]);
        if (!Number.isNaN(parsed.getTime())) lastActivityAt = parsed.toISOString();
      }

      out.push({
        rowEl: nameRow?.row || phoneRow.row, // for click-to-expand panel
        nameRowEl: nameRow?.row || null,
        phoneRowEl: phoneRow.row,
        name,
        phone: phoneLeaf,
        company,
        role: roles.length > 0 ? roles.join(", ") : null,
        number_of_visits: visits,
        level_of_interest: levelOfInterest,
        last_activity_label: lastActivityLabel,
        last_activity_at: lastActivityAt,
      });
    }

    return out;
  }

  // Snapshot of what's actually on the page — emitted when readListView
  // returns 0 so we can debug remotely without a real browser session.
  function pageDiagnostic() {
    const lowerBody = document.body.textContent.toLowerCase();
    const probable_state =
      /sign in|log in|please log/i.test(lowerBody) ? "AUTH_REQUIRED"
      : /loading|please wait/i.test(lowerBody) && lowerBody.length < 400 ? "LOADING_SPINNER"
      : document.querySelectorAll("[role=row]").length === 0 ? "EMPTY_PAGE"
      : "DATA_NEVER_LOADED";

    // For the FIRST 3 phone leaves on the page, walk up and capture the
    // row container details so we can see what shape CREXi's DOM has.
    // This is the key debug payload — without it, we're guessing.
    const phoneLeaves = Array.from(document.querySelectorAll("body *")).filter(
      (n) =>
        n.children.length === 0 &&
        /^\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}$/.test((n.textContent || "").trim())
    );

    const rowSamples = phoneLeaves.slice(0, 3).map((phoneEl) => {
      const phoneText = phoneEl.textContent.trim();
      // Walk up 8 levels and capture each ancestor's signature
      const ancestors = [];
      let cursor = phoneEl;
      for (let i = 0; i < 8; i++) {
        cursor = cursor.parentElement;
        if (!cursor || cursor === document.body) break;
        ancestors.push({
          depth: i + 1,
          tag: cursor.tagName?.toLowerCase() || "?",
          role: cursor.getAttribute?.("role") || null,
          classes: (cursor.className || "").toString().slice(0, 80),
          childCount: cursor.children.length,
          textLen: (cursor.textContent || "").length,
        });
      }
      // Also: try findRowContainer logic and report what it picked
      let resolvedRow = null;
      let rcCursor = phoneEl;
      for (let i = 0; i < 8; i++) {
        rcCursor = rcCursor.parentElement;
        if (!rcCursor || rcCursor === document.body) break;
        const tag = rcCursor.tagName?.toLowerCase() || "";
        const role = rcCursor.getAttribute?.("role") || "";
        if (
          role === "row" ||
          tag === "tr" ||
          tag === "mat-row" ||
          tag === "cdk-row" ||
          rcCursor.classList?.contains("mat-row") ||
          rcCursor.classList?.contains("mat-mdc-row") ||
          rcCursor.classList?.contains("cdk-row")
        ) {
          resolvedRow = rcCursor;
          break;
        }
      }

      const rowSig = resolvedRow
        ? {
            tag: resolvedRow.tagName?.toLowerCase(),
            role: resolvedRow.getAttribute?.("role"),
            classes: (resolvedRow.className || "").toString().slice(0, 80),
            text: (resolvedRow.textContent || "").trim().slice(0, 250),
            leafCount: Array.from(resolvedRow.querySelectorAll("*")).filter(
              (n) => n.children.length === 0 && (n.textContent || "").trim().length > 0
            ).length,
            leafTexts: Array.from(resolvedRow.querySelectorAll("*"))
              .filter((n) => n.children.length === 0 && (n.textContent || "").trim().length > 0)
              .map((n) => n.textContent.trim().slice(0, 50))
              .slice(0, 12),
          }
        : null;

      return {
        phone: phoneText,
        ancestors,
        resolvedRow: rowSig,
      };
    });

    return {
      doc_url: window.location.href,
      doc_path: window.location.pathname,
      doc_title: document.title,
      doc_state: document.readyState,
      probable_state,
      counts: {
        tr: document.querySelectorAll("tr").length,
        td: document.querySelectorAll("td").length,
        role_row: document.querySelectorAll("[role=row]").length,
        role_gridcell: document.querySelectorAll("[role=gridcell]").length,
        mat_row: document.querySelectorAll("mat-row, .mat-row, .mat-mdc-row, cdk-row").length,
        mat_table: document.querySelectorAll("mat-table, .mat-table, .mat-mdc-table, cdk-table").length,
        any_table: document.querySelectorAll("table").length,
        all_elements: document.querySelectorAll("*").length,
      },
      phones_detected: (document.body.textContent.match(/\d{3}\.\d{3}\.\d{4}/g) || []).slice(0, 8),
      phone_leaf_count: phoneLeaves.length,
      // The actual debug payload: 3 sample phones + their full ancestor
      // chain + what findRowContainer would resolve them to + the leaf
      // texts inside that resolved row. This tells us why parseRow returned null.
      row_samples: rowSamples,
      body_text_sample: document.body.textContent.replace(/\s+/g, " ").slice(0, 400),
    };
  }

  // ── Side-panel scraping ────────────────────────────────────────────────
  // After clicking a row, CREXi slides in a panel from the right. It
  // contains the lead's full contact info + an activity timeline.

  // Surface for one-time panel diagnostic — populated on first attempt
  // when no email captured. Read by the orchestrator and sent up to API.
  let _firstPanelDiagnostic = null;

  // Fire a "real" mouse click with the full event sequence. Pure .click()
  // produces isTrusted=false events, which most Angular Material apps
  // accept, but CREXi's row handler appears to require the full sequence.
  function dispatchRealClick(el) {
    if (!el || typeof el.dispatchEvent !== "function") return false;
    try {
      el.scrollIntoView({ block: "nearest", behavior: "auto" });
    } catch {}
    const opts = { bubbles: true, cancelable: true, view: window, button: 0 };
    const events = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"];
    for (const type of events) {
      try {
        const Ctor = type.startsWith("pointer") ? PointerEvent : MouseEvent;
        el.dispatchEvent(new Ctor(type, opts));
      } catch {
        // Fallback to simple Event if PointerEvent isn't available
        try {
          el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
        } catch {}
      }
    }
    return true;
  }

  async function scrapePanel(row, isFirstAttempt = false) {
    // Capture pre-click email set for diff detection
    const emailsBefore = new Set(
      (document.body.textContent.match(/\b[\w.+-]+@[\w.-]+\.\w{2,}\b/g) || [])
    );

    // Track BOTH <aside> and <mat-sidenav> — CREXi opens lead detail into
    // the latter, but other surfaces use the former.
    const asideTextBefore = (document.querySelector("aside")?.textContent || "").trim();
    const sidenavBefore = Array.from(document.querySelectorAll("mat-sidenav, [class*='mat-sidenav']:not([class*='content']):not([class*='container'])"))
      .map((el) => (el.textContent || "").length)
      .reduce((a, b) => a + b, 0);

    if (!row) return null;
    dispatchRealClick(row);

    // Wait for the panel to populate. CREXi uses <mat-sidenav> for the
    // lead-detail slide-out; other apps use <aside>. We watch both.
    const panel = await waitFor(
      () => {
        // Strategy 1: a NEW email-shaped text appears on the page (the
        // lead's email rendering inside the panel that just opened)
        const allEmails = document.body.textContent.match(/\b[\w.+-]+@[\w.-]+\.\w{2,}\b/g) || [];
        const newEmails = allEmails.filter((e) => !emailsBefore.has(e));
        if (newEmails.length > 0) {
          const targetEmail = newEmails[0];
          const all = document.querySelectorAll("body *");
          for (const el of all) {
            if ((el.textContent || "").includes(targetEmail) && (el.textContent || "").length < 6000) {
              return el;
            }
          }
        }
        // Strategy 2: <mat-sidenav> grew significantly (CREXi's panel)
        const sidenavs = Array.from(document.querySelectorAll("mat-sidenav, [class*='mat-sidenav']:not([class*='content']):not([class*='container'])"));
        const sidenavNow = sidenavs.map((el) => (el.textContent || "").length).reduce((a, b) => a + b, 0);
        if (sidenavNow > sidenavBefore + 200) {
          // Find the specific sidenav that grew
          for (const el of sidenavs) {
            const text = el.textContent || "";
            if (text.length > 500 && /\d{3}\.\d{3}\.\d{4}|@/.test(text)) {
              return el;
            }
          }
        }
        // Strategy 3: <aside> grew
        const aside = document.querySelector("aside");
        if (aside) {
          const text = aside.textContent || "";
          if (text.length > asideTextBefore.length + 100 && /\d{3}\.\d{3}\.\d{4}|@/.test(text)) {
            return aside;
          }
        }
        // Strategy 4: explicit Email: label in any container of reasonable size
        const labeled = document.querySelectorAll("mat-sidenav, aside, [class*='side-panel'], [class*='detail-panel'], [class*='lead-detail'], [role='dialog'], [class*='drawer']");
        for (const c of labeled) {
          const text = c.textContent || "";
          if (/Email\s*:?\s*[\w.+-]+@[\w.-]+\.\w{2,}/i.test(text) && text.length < 6000) {
            return c;
          }
        }
        return null;
      },
      { maxMs: 2000 }
    );

    // First-attempt diagnostic: capture page state regardless of success.
    if (isFirstAttempt && !_firstPanelDiagnostic) {
      const aside = document.querySelector("aside");
      const sidenavs = Array.from(document.querySelectorAll("mat-sidenav"));
      const sidenavTextNow = sidenavs.map((el) => (el.textContent || "").length).reduce((a, b) => a + b, 0);
      const allPanels = Array.from(
        document.querySelectorAll("mat-sidenav, aside, [class*='side-panel'], [class*='detail-panel'], [class*='lead-detail'], [role='dialog'], [class*='drawer']")
      );
      _firstPanelDiagnostic = {
        clicked_tag: row.tagName?.toLowerCase(),
        clicked_role: row.getAttribute?.("role"),
        panel_found: !!panel,
        panel_tag: panel?.tagName?.toLowerCase() || null,
        panel_class: (panel?.className || "").toString().slice(0, 80),
        aside_text_before_len: asideTextBefore.length,
        aside_text_after_len: aside?.textContent?.length || 0,
        sidenav_text_before_len: sidenavBefore,
        sidenav_text_after_len: sidenavTextNow,
        emails_on_page_after: (document.body.textContent.match(/\b[\w.+-]+@[\w.-]+\.\w{2,}\b/g) || []).slice(0, 8),
        candidate_panels: allPanels.slice(0, 5).map((p) => ({
          tag: p.tagName?.toLowerCase(),
          classes: (p.className || "").toString().slice(0, 60),
          textLen: (p.textContent || "").length,
          textSample: (p.textContent || "").replace(/\s+/g, " ").slice(0, 200),
        })),
      };
    }

    if (!panel) return null;

    const text = panel.textContent || "";
    const html = panel.innerHTML || "";

    // Email — prefer the one labeled "Email:" (avoids accidentally
    // capturing the user's own logged-in email if it shows in the chrome).
    let emailMatch = text.match(/Email\s*:?\s*([\w.+-]+@[\w.-]+\.\w{2,})/i);
    if (!emailMatch) {
      // Fallback: any email-shaped string anywhere in the panel
      emailMatch = text.match(/([\w.+-]+@[\w.-]+\.\w{2,})/);
    } else {
      emailMatch = [emailMatch[0], emailMatch[1]]; // normalize to [full, captured]
    }

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
      email: emailMatch ? emailMatch[1] || emailMatch[0] : null,
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

    // Wait for the table to render. With minimized-window JS unthrottled,
    // 8s is usually plenty, but we allow up to 20s for slow data loads.
    await waitFor(
      () => readListView().length > 0,
      { maxMs: 20000 }
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
    // Circuit-breaker: if panel scrape fails 3 times in a row early in
    // the cycle, give up on panels for the rest of this run. Still
    // captures list-view data (name + phone + company + role + status);
    // emails just stay null. Better than a 180s timeout that loses
    // everything.
    let consecutivePanelFailures = 0;
    let panelScrapeAborted = false;
    const MAX_CONSECUTIVE_PANEL_FAILURES = 3;

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

      if (shouldDeepScrape(row, priorCache) && !panelScrapeAborted) {
        const isFirstDeepScrape = enriched.length === 0;
        let panel = null;
        try {
          // ONE attempt per lead — name-row first. If it fails, count
          // toward the circuit-breaker. Don't waste time on phoneRow
          // fallback (it's the same DOM tree, so it's unlikely to work
          // if the name-row click didn't).
          if (row.nameRowEl) {
            panel = await scrapePanel(row.nameRowEl, isFirstDeepScrape);
          } else if (row.phoneRowEl) {
            panel = await scrapePanel(row.phoneRowEl, isFirstDeepScrape);
          }
          if (panel) {
            baseLead.email = panel.email || baseLead.email;
            baseLead.activity_timeline = panel.activity_timeline;
            baseLead.buyer_evaluation = panel.buyer_evaluation;
            consecutivePanelFailures = 0;
          } else {
            consecutivePanelFailures += 1;
            if (consecutivePanelFailures >= MAX_CONSECUTIVE_PANEL_FAILURES) {
              panelScrapeAborted = true;
            }
          }
        } catch (e) {
          baseLead._panel_error = String(e?.message || e);
          consecutivePanelFailures += 1;
          if (consecutivePanelFailures >= MAX_CONSECUTIVE_PANEL_FAILURES) {
            panelScrapeAborted = true;
          }
        }
        await sleep(250);
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

    // Compose return — include panel diagnostic when emails are missing
    const emailsCaptured = enriched.filter((l) => l.email).length;
    return {
      ok: true,
      listing_id: listingId,
      leads_count: enriched.length,
      emails_captured: emailsCaptured,
      panel_scrape_aborted: panelScrapeAborted,
      panel_diagnostic: emailsCaptured === 0 ? _firstPanelDiagnostic : null,
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
