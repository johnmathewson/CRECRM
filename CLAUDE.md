# CLAUDE.md — Stewardship CRM (CRECRM)

> Working memory for Claude assistants. Auto-loaded as context when working in this repo. Read this first.

---

## Quick orientation

This is the **internal CRM dashboard** for John Mathewson (Stewardship CRE / Stewardship Asset Group). Single-user, auth-walled, deployed on Netlify as `stewardship-crm`. It's the operations brain — comp analysis, rent-roll intake, deal pipeline, contact management, and (currently being built) the **inbound lead inbox**.

**Sibling repo:**
| Repo | Purpose | Path |
|---|---|---|
| `CRECRM` (this one) | Internal CRM dashboard | `~/Documents/GitHub/CRECRM` |
| `stewardshipcre` | Public marketing site | `~/Documents/GitHub/stewardshipcre` |

The two apps are deliberately separate. Marketing site = read-only public. CRM = operations behind auth wall. They communicate via one HTTPS connector: marketing-site contact form → POST `/api/leads/intake` here.

**Cross-references:**
- `~/Documents/GitHub/stewardshipcre/CLAUDE.md` — full ecosystem memory (brand, decisions, lead pipeline architecture)
- `~/Documents/GitHub/stewardshipcre/PROJECT.md` — original architectural deep-dive
- `~/Documents/GitHub/stewardshipcre/public/lead-pipeline-map.html` — visual architecture diagram of the lead flow

---

## Stack

- **Next.js 14.2.21** (App Router) + **React 18.3.1** + **TypeScript 5.7** strict
- **Tailwind 3.4** with `tailwind.config.ts` (NOT v4 like the marketing site)
- **Supabase** via `@supabase/supabase-js` + `@supabase/ssr`
- **`@anthropic-ai/sdk` 0.39.0** — *installed but NOT used*. All Claude calls are **raw fetch to `api.anthropic.com/v1/messages`**. Match that pattern.
- Document parsing: `xlsx` (client-side), `pdf-parse` + `mammoth` (installed for future server-side use)
- `recharts` for visualizations
- **Netlify** deploy via `@netlify/plugin-nextjs`

---

## Current production schema (Supabase)

Tables already in production (do **NOT** alter without explicit ask):

```
intakes              -- rent-roll document submissions
intake_units         -- individual units/tenants from rent rolls
comps                -- comparable lease/sale data (rich schema: sale + lease, geo, dates, terms)
deals                -- sales/leasing opportunities (incl. is_dead, dead_reason)
deal_stages          -- deal pipeline state transitions, current = WHERE exited_at IS NULL
properties           -- asset inventory (id, name, address, asset_type, status, asking_price, sqft, your_role)
contacts             -- relationship database (full_name, email, phone, warmth, contact_type)
companies            -- vendor/partner entities

RPCs:
  get_assistant_context()    -- SECURITY DEFINER, returns deals/stages/properties/contacts/companies in one call
  find_nearby_comps()        -- PostGIS function: find_nearby_comps(lat, lng, radius_miles, asset_type, limit)
                                used by stateless valuation engine
```

**Pipeline stages** (`deal_stages.stage` enum): `Lead | LOI | Listing | Under Contract | Closed`. Note: the first stage is literally **"Lead"** — semantic overlap with the `leads` table is intentional. When an inbox lead promotes to a deal via "Promote to Deal" button, the deal enters at stage `Lead`.

**Valuation engine is stateless** — no `valuations` table. Pulls comps via `find_nearby_comps()`, analyzes in-memory, returns JSON or PDF. Pattern lesson: don't over-engineer storage for AI extractions; jsonb + re-derive is fine. (See `src/lib/valuation-engine.ts`.)

**No `database.types.ts` exists.** Types are inferred inline from component state objects.

**Single-user constants** (hardcoded in inserts, see `/src/app/api/intake/save/route.ts:4-5`) — **VERIFIED real rows in DB:**
```ts
const ORG_ID  = "a0000000-0000-0000-0000-000000000001"  // organizations.name = "Stewardship Asset Group"
const USER_ID = "b0000000-0000-0000-0000-000000000001"  // users.email = "john@johnmathewson.co"
```

The DB has full multi-tenant capability (`organizations` + `users` + `roles` tables) but the frontend currently hardcodes these constants. Match the existing pattern.

**Supabase project:** `CRE Intelligence Platform` (project_id `sxqvrcmmgawaunssstyd`, region `us-east-1`). Connect via Supabase MCP — Claude has direct access to apply migrations and run SQL.

**Project memory table** — `project_memory` (created in migration 0002). Cross-machine state cursor for major builds:
```sql
SELECT * FROM project_memory WHERE project_slug = 'lead-pipeline';
```
Read this from any machine to pick up current phase, pending tasks, decisions, and a markdown summary.

**The full DB has 38 tables** — way more than what the frontend currently uses. Beyond the 8 mapped above:
`submarkets`, `submarket_benchmarks`, `demand_profiles` (market intel layer) ·
`signals`, `signal_actions` (opportunity-detection / agent system) ·
`sale_comps` (1853 rows — the real comp DB; `comps` is just 82 rows of curated subset), `lease_comps`, `assessor_records`, `parcels`, `property_parcels`, `beneficial_owners` (county/ownership data) ·
`listings`, `buildings`, `leases`, `units` (proper inventory model) ·
`activities`, `tasks`, `communications`, `linked_deals`, `deal_offers`, `commissions` ·
`documents`, `document_extractions`, `import_jobs` ·
`organizations`, `users`, `roles` ·
PostGIS extension active (`spatial_ref_sys`).

---

## Auth model

**Supabase email + password**, gated at the middleware layer (`/src/middleware.ts`). Any route not whitelisted requires a valid session.

**Single user:** John Mathewson (`john@johnmathewson.co`, hardcoded display in `/src/components/nav.tsx`).

**To gate a new authenticated route** (e.g., `/inbox`): nothing to do. Middleware protects it automatically. Just create `/src/app/inbox/page.tsx`.

**To create a PUBLIC API route** (e.g., `/api/leads/intake` for Apps Script + Twilio webhooks that can't authenticate): mirror the existing `/api/valuate` pattern — that endpoint accepts unauthenticated POSTs. **Check `src/middleware.ts` to see how `/api/valuate` is exempted, and add `/api/leads/intake` (and `/api/leads/[id]/sms-webhook`, etc.) to the same allowlist.** This is critical — without it, the Apps Script POSTs will 401.

---

## Currently being built: inbound lead pipeline

This is the active build. **Mobile-first** — the broker reviews leads from his phone 90% of the time.

### The flow
```
Lead arrives  ──►  Apps Script catches  ──►  POST /api/leads/intake (THIS REPO)
(any channel)      (60-sec poll)              ▼
                                              Claude Haiku extracts
                                              (sender · property · intent · urgency)
                                              ▼
                                              Insert into leads table
                                              ▼
                          ┌───────────────────┼───────────────────┐
                          ▼                   ▼                   ▼
                    Auto-ack (<60s)     Claude Sonnet         Twilio SMS
                    via Gmail API       drafts substantive    to John's cell
                    from john@stew…     reply w/ OM attached  with /inbox/[id] link
                                                              ▼
                                                              John reviews + sends
                                                              from john@stew… via Gmail API
```

### Channel ingress paths (all converge to `/api/leads/intake`)
| Channel | Ingress | Auto-ack |
|---|---|---|
| Email (CREXi/LoopNet/Buildout/direct) | Apps Script polling Workspace | Auto-reply email |
| SMS | Twilio webhook | Auto-reply SMS to sender |
| Voice | Twilio voicemail → transcription → webhook | Auto-reply **SMS** to caller (NOT voicemail — creepy) |
| Website form | `stewardshipcre.com` POSTs cross-origin | Auto-reply email |

### Two-tier acknowledgment SLA (locked decision)
- **<60 sec:** brief auto-receipt. Auto-sent. NO OM, no details:
  > Hey [Name] — got your inquiry on **[property]**. I'm running between meetings right now but will follow up personally within the hour. — John
- **<60 min:** AI-drafted substantive reply, OM attached, **John taps to send.** Risk drops to near-zero on multi-million-dollar deals.

---

## Schema for the lead pipeline (APPLIED — see migrations 0001 + 0002)

**Important correction:** the original plan was "create a new `leads` table + `lead_messages` table." The actual DB already had a `leads` table (used by the public valuation_agent endpoint) AND a `communications` table that already provides channel/direction/from/to/subject/body/raw_payload — exactly what `lead_messages` would have been.

**The real plan, applied:**

1. **Extend the existing `leads` table** with inbox fields (rather than creating a parallel one). Backwards-compatible with the existing valuation_agent rows.
2. **Add `lead_id` FK to `communications`** so each inbound/outbound message threads to a lead.
3. **Don't create a `lead_messages` table** — `communications` is exactly that.

**Net schema for the lead pipeline:**

```
leads  (existing table, extended)
├── id, organization_id, contact_id, property_id           [pre-existing]
├── source, status, assigned_to, notes                      [pre-existing — source/status are text not enums]
├── sender_name, sender_email, sender_phone                 [NEW]
├── property_label                                          [NEW — "Joliet medical building"]
├── intent (enum: buy|lease|sell|info|other)                [NEW]
├── urgency (enum: hot|warm|cold)                           [NEW, default 'warm']
├── qualifier_summary                                       [NEW — AI-extracted: "1031 buyer, $4M, 60-day"]
├── raw_subject, raw_body                                   [NEW]
├── claude_extraction jsonb                                 [NEW]
├── auto_ack_sent_at                                        [NEW — 60-sec receipt fired at]
├── draft_reply, draft_attachments jsonb                    [NEW]
├── final_reply, final_sent_at                              [NEW]
└── linked_deal_id → deals                                  [NEW — promote-to-deal path]

communications  (existing table, extended)
└── lead_id → leads                                         [NEW — thread inbound/outbound to a lead]
```

**Files in repo:**
- `supabase/migrations/0001_extend_leads_for_inbox.sql` — schema extension above
- `supabase/migrations/0002_project_memory.sql` — cross-machine state table

**Schema migrations are managed via Supabase MCP.** Claude can apply migrations directly, then writes the corresponding SQL file to `supabase/migrations/` for replayability.

**RLS:** existing tables have RLS enabled (38 of them) but the frontend uses the anon key with hardcoded org/user IDs. Match that for now — single user. Tighten when we add multi-user.

---

## Routes — what exists, what's being added

**Existing pages** (`src/app/`):
```
/                Dashboard
/intake          Rent-roll intake (XLSX/CSV/image upload → Claude → intake_units)
/comps           Comps database viewer
/valuate         Property valuation UI
/properties      Asset inventory
/contacts        Contact database
/deals           Deal pipeline (drag-and-drop via @dnd-kit, multi-select, mark-dead)
/reports         Reports
/login, /auth/callback
```

**Existing API routes:**
```
/api/assistant            Claude Sonnet, AI assistant bar (db snapshot in system prompt)
/api/intake/parse         Claude Haiku, parses rent-roll text/image → JSON
/api/intake/save          Persists parsed intake to Supabase
/api/comps/parse          Claude Haiku, parses comp data
/api/comps/import         CoStar Excel import
/api/valuate              PUBLIC route — accepts JSON, returns JSON | PDF | both. Mirror this pattern for /api/leads/intake.
/api/test                 Dev test endpoint
```

**Current nav tabs** (`src/components/nav.tsx`, `links` array):
```
Dashboard | Intake | Comps | Valuation | Properties | Contacts | Deals | Reports
```

**To add (lead pipeline):**

| Route | Purpose | Notes |
|---|---|---|
| `/inbox` | Lead list view | Card stack (NOT a table — mobile-first). Sort by `created_at desc`. Status badges. Urgency color (hot=teal, warm=charcoal, cold=muted). |
| `/inbox/[id]` | Lead detail + draft review | Twilio SMS deeplinks land here. Sticky bottom action bar: **Send · Edit · Archive · Promote to Deal**. Thumb-zone buttons. |
| `/api/leads/intake` | Universal ingress endpoint, **PUBLIC** | POSTs from Apps Script (email), Twilio (SMS/voice), public site (form). Branches on `source`. Add to middleware allowlist alongside `/api/valuate`. |
| `/api/leads/[id]/send` | Sends final approved reply | Reads possibly-edited `draft_reply`, sends via Gmail API from `john@stewardshipcre.com`, updates `final_reply`, `final_sent_at`, `status='sent'`. Authenticated. |
| `/api/leads/[id]/ack` | Internal — fires 60-sec auto-receipt | Called by `/intake`. Inserts row in `lead_messages` (direction: outbound). |
| `/api/leads/sms-webhook` | Twilio SMS inbound webhook | **PUBLIC.** Twilio POSTs here; converts to standard intake payload. |
| `/api/leads/voice-webhook` | Twilio voicemail transcription webhook | **PUBLIC.** |

**Adding to nav** — append to `links` array. Note: 9 tabs total now (Dashboard | Intake | Comps | Valuation | Properties | Contacts | Deals | Reports | **Inbox**) — likely needs mobile nav redesign (hamburger or icon-only at narrow widths). Worth raising with John before just appending.

---

## Reusable patterns already in the codebase

These are solved muscles. Don't reinvent.

- **PDF generation:** `src/lib/report-generator.ts` uses `jspdf` + `jspdf-autotable` server-side. Pattern: `generateReportBytes(type, data) → Uint8Array → NextResponse(Buffer.from(bytes), {Content-Type: 'application/pdf'})`. Reuse for AI-generated lead briefs / OM teasers if we want.
- **Drag-and-drop:** `@dnd-kit/core` + `@dnd-kit/sortable` powers the deal pipeline. `PointerSensor` works on touch. If we want drag-to-archive or drag-to-promote-deal in the inbox, this lib is already vendored.
- **Inline edit + modal pattern:** `EditableField` + modal in `src/components/deals-content.tsx` is the canonical inline-edit pattern. Mirror it in the inbox's draft-reply edit experience for visual consistency.
- **PostGIS geo queries:** if the lead pipeline ever needs "leads within X miles of a property," `find_nearby_comps()` shows the RPC pattern.

---

## Coding conventions (lock these — they're already in the codebase)

- **kebab-case** filenames (`create-contact-modal.tsx`, `intake-upload-zone.tsx`, `deals-content.tsx`)
- All components use `"use client"`
- **Raw fetch** to Anthropic API (NOT the SDK abstraction):
  ```ts
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model, max_tokens, system, messages })
  });
  ```
- **Models in production:**
  - `claude-haiku-4-5-20251001` — fast/cheap extraction (use for lead intake parsing)
  - `claude-sonnet-4-20250514` — quality drafting (use for substantive lead reply drafts)
- **Add prompt caching** for OM context — listing OMs are reused across many lead drafts; this is a huge cost win
- **State:** plain `useState` / `useCallback` / `useEffect`. No zustand/jotai/redux/zod.
- **Forms:** custom inline `useState({...})` + inline change handlers (see `create-contact-modal.tsx`). No form libraries.
- **Styling:** Tailwind classes inline + custom `.glass` classes in `/src/app/globals.css`. No shadcn/radix.
- **HTTP:** `fetch()` directly. No axios/tRPC.
- **Validation:** inline checks + `alert()` for now. No zod (don't introduce — match existing pattern).

---

## Brand colors (mirror the marketing site for visual continuity)

```
Charcoal-950 (page bg)        #0D0D0D
Charcoal-900 (sections)       #1A1A1A
Charcoal-800 (cards)          #282828
Teal-400 (accent)             #4ECDC4
```

Use existing `.glass` classes for cards. Mobile-first: 16px+ font, no horizontal scroll, thumb-zone CTAs on `/inbox/[id]`.

---

## Daily CREXi lead reports → must land on `contacts` (REQUIREMENT)

> Locked decision, 2026-05-15. **Every CREXi-sourced lead must end up as a row in `contacts`**, with `crexi_leads_state` linking to it via `contact_id`. The contacts table is canonical — `crexi_leads_state` is a per-listing denormalized cache. A lead that exists only in `crexi_leads_state` is a data leak.

### Flow

```
CREXi → "Lead Report - <property>.xlsx" emailed daily
   ↓
   inquiries@stewardshipcre.com  (user is redirecting these here once everything is set up)
   ↓
   poll-gmail cron picks up the attachment
   ↓
   parseCrexiReport() extracts every lead from the Detail sheet
   ↓
   For each lead (find-or-create chain):
     1. contacts row    — match by lower(email); create if missing
     2. crexi_leads_state row — match by (property_id, lower(email)); link contact_id; create if missing
     3. activities entry on the property timeline ("CREXi engagement: <signal>")
```

### Implementation rules

- **Email is the canonical key.** Every CREXi user has an email (CREXi requires it to register). If a parsed row has no email, the parser is wrong — fix the parser, don't insert a ghost row.
- **Match into `contacts` first**, then create/update `crexi_leads_state` with the resulting `contact_id`. Never create a `crexi_leads_state` row without a `contact_id` set.
- **Dedup is case-insensitive on email.** `lower(trim(email))`. Same goes for name fallback matching when email collides across spellings.
- **Don't double-touch contacts.** If a contact already exists (via marketing-site form, NDA signing, prior lead, etc.), enrich it — don't create a duplicate. Preserve `full_name`, `email`, `phone`, `company` with `COALESCE(existing, new)` semantics so manually-curated fields win over auto-imports.
- **Activities, not just state.** Every CREXi-sourced engagement signal (Executed CA / Downloaded OM / Visited Page N times) should write an `activities` row on the property timeline so the broker sees the journey, not just the latest state snapshot.
- **The browser extension scrape path** (`/api/extension/crexi-leads`) is secondary — it captures lead-list-table rows without email (CREXi's UI doesn't expose email until you click into the detail panel). It is a **provisional cache** only; the XLSX import is always source of truth and must overwrite/merge.

### Schema linkage (verified production)

```
contacts.id  ←──────────────────  crexi_leads_state.contact_id  (FK, must be set)
contacts.id  ←──────────────────  leads.contact_id              (already in place)
contacts.id  ←──────────────────  activities.contact_id         (link engagement signals)
```

### Known historical issue (cleaned 2026-05-15)

The browser extension and the XLSX parser were writing to `crexi_leads_state` independently, with case-sensitive name-match dedup. Result: 100+ ghost rows on Liberty Square + Super 8 with `email = NULL` and `contact_id = NULL`. Cleaned via two SQL passes (~86 ghosts removed, 12 emails backfilled, 12 net-new leads inserted from fresh XLSX). **The upsert and extension paths still need to be hardened to prevent recurrence** — flagged in open threads.

### Open work tied to this requirement

1. **`crexi-report` route** (`src/app/api/leads/crexi-report/route.ts`) — currently writes to `crexi_leads_state` only. Extend to find-or-create `contacts` row first and persist `contact_id`. **Mirror the contact-resolution pattern from `/api/extension/crexi-leads`** (which already does email → phone match into `contacts`), but make XLSX the authoritative source.
2. **Dedup hardening** — change `.eq("name", lead.fullName)` to case-insensitive trim-aware match, and add an email-primary key everywhere.
3. **Backfill `contact_id` on existing rows** — one-time migration: for every existing `crexi_leads_state` row, find-or-create a contact and link.
4. **Activities backfill** — write timeline entries for every CREXi engagement signal currently sitting only in `crexi_leads_state`.

---

## External integrations status

- **Google Workspace:** mailbox `inquiries@stewardshipcre.com` being provisioned (separate from `john@stewardshipcre.com` to keep AI watcher's signal clean — no classification step needed)
- **Twilio:** number `+1 (317) 804-1980` purchased. **A2P 10DLC registration in progress** (required before SMS to consumers delivers reliably). Token was leaked in chat once → rotated. Env vars: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `TWILIO_NOTIFY_TO_NUMBER` (John's cell)
- **Gmail API for sending:** use the Workspace Gmail API with domain-wide delegation OR OAuth on `john@stewardshipcre.com` to send from that address
- **Drive folder for OMs:** `/Stewardship CRE/Active Listings/[address]/` — OAuth grant once, AI reads OM + due diligence per matched listing
- **Anthropic:** `ANTHROPIC_API_KEY` already configured (existing routes use it)

---

## Voice + tone for AI-drafted content

- John reads pro formas the way **investors** do, not the way listing agents do (he's an active CRE owner himself).
- Voice is direct, concrete, numbers-forward. NO "elevate your portfolio" / "luxury" / "premier opportunity" broker-speak.
- Substantive replies: tight, 2-3 qualifying questions max, OM attached, signature block.
- Auto-acknowledgment template (locked, do not embellish):
  > Hey [Name] — got your inquiry on **[property]**. I'm running between meetings right now but will follow up personally within the hour. — John

---

## Open threads (as of this write)

1. ~~**Schema migration**~~ — DONE. Migrations 0001 + 0002 applied via Supabase MCP. Tracked in `supabase/migrations/`.
2. **`/api/leads/intake`** — next deliverable. Mirrors the existing `/api/intake/parse` pattern (raw fetch, JSON-prompt extraction). **Mirror the `/api/valuate` middleware exemption** so Apps Script + Twilio can POST without auth.
3. **`/inbox` + `/inbox/[id]` UI** — mobile-first card list + split detail page with sticky bottom action bar.
4. **Apps Script email watcher** — separate Apps Script project in John's Google Workspace. Polls `inquiries@stewardshipcre.com` every 60s, POSTs new emails to `/api/leads/intake`.
5. **Twilio SMS + voice webhooks** — point at `/api/leads/intake` (or dedicated `/api/leads/sms-webhook`, `/api/leads/voice-webhook`) with `source: 'sms'` / `source: 'phone'`.
6. **Public site contact form** — currently unwired; will POST to this CRM's `/api/leads/intake` once endpoint exists.
7. **CREXi lead reports → contacts table** (locked 2026-05-15, see dedicated section above) — extend `/api/leads/crexi-report` to find-or-create a `contacts` row for every parsed lead and link `crexi_leads_state.contact_id`. Backfill existing rows. Daily reports being redirected to `inquiries@stewardshipcre.com`.

**Reading current build state from any machine:**
```sql
SELECT current_phase, state, markdown FROM project_memory WHERE project_slug = 'lead-pipeline';
```
Or in Supabase Studio: Table Editor → `project_memory` → row.

---

*Last updated: April 2026. When in doubt, ask John before assuming.*

---

## Prospector voice / skill — design philosophy (2026-05-15 distillation)

A long external "Commercial Property Sale Inquiry Response Skill" document
was proposed for the agent. We distilled the high-value parts into the
existing system rather than dropping it in whole. Notes for future Claude:

### Adopted into the system

1. **First-person-as-John rule.** Personas (especially `listing_inquiry_followup`)
   and the global broker voice both now enforce: never refer to John in third
   person. Write "I can help" not "John can help."

2. **Use the recipient's role first.** Recipient.role is already passed to
   the personalizer in the user-text prompt; both the persona angle and the
   global voice rules now explicitly instruct: anchor on the role, never
   ask them to identify what they are.

3. **4-tier information classification (public / qualified / nda / restricted)**
   baked into the `listing_inquiry_followup` persona angle AS GUIDANCE, plus
   shipped as actual structured data on `properties.document_inventory` so
   the AI can reference real per-property documents. The combination is more
   useful than either alone.

4. **Red-flag awareness** (wholesalers, competitors fishing, tenants probing
   for sale strategy, etc.) — folded into the persona angle.

### Explicitly rejected from the doc — don't re-add

- **CRM-note "Lead Summary" output format.** Wrong artifact — that's a
  separate AI call, not part of the reply-drafter.
- **Hardcoded "Follow-Up 1/2/3" templates.** Competes with the few-shot
  retrieval system. Static templates lock in voice that can't evolve;
  retrieval pulls John's *actual* recent emails as examples and gets sharper
  over time.
- **"Showing rules" with tenant-notice / seller-approval logic.** AI can't
  verify or execute those — they're broker decisions. If we want to surface
  flags ("⚠ this looks like a tour request, confirm with seller"), that's a
  separate output schema, not drafting instructions.
- **"Never reveal it's an agent" rule as worded.** Risky framing. The honest
  framing is: AI drafts, John reviews + sends. So every email IS from John
  with AI assistance. Don't dance around it.
- **The 7,000-word document length itself.** Prompts dilute attention as
  they grow; we kept the persona angle ~3,700 chars (was 1,318), well under
  the point where the model starts ignoring instructions.

### Pattern for future "skill upgrades"

When someone proposes a new agent skill / instruction document:
1. Identify the unique high-value insights (typically 3-5 ideas).
2. Map each to an existing system layer (broker_voice / persona / property /
   skill / few-shot example / output schema).
3. Reject anything that duplicates what we have or competes with the
   voice-learning loop.
4. Implement surgically. Migrations + SQL updates beat appending text to
   a prompt nine times out of ten.

---

## STATE OF THE WORLD — 2026-07-28 (pick up here)

**A2P 10DLC: APPROVED + LIVE.** Campaign `CM80f43e0659fb3e4801d6f1078cffdb44` (Low Volume Mixed, TCR ID CWHCUNR) on brand `BNbe70570…` ("Stewardship Commercial Real Estate"). We deleted 11 duplicate/failed campaigns and registered one clean one — never stack campaigns again; ONE campaign, edit via its fields. Messaging Service `MG433c934afdf170850586d136c6317058` ("Stewardship CRE (A2P approved)") has the number +13178041980 and the inbound webhook. `TWILIO_TEST_MODE=false` since 7/28 (~18:15Z) — **sends are REAL now**. First production SMS sent to Rahul (Super 8) 7/28.

**SMS both directions works end-to-end:**
- Inbound: `/api/webhooks/twilio/sms` → mirrors to `communications` (idempotent on MessageSid) → finds/creates lead (30-day thread window by phone) → attaches mirror row to lead. STOP/HELP/START handled.
- Outbound: `/api/leads/[id]/send-sms` (session-authed) + "Text message" composer panel in the lead workspace (`LeadDetail.tsx`). Threads as touch_kind='manual'.
- Reply notifications SHIPPED 7/28 (2nd half of day): inbound SMS (fresh or thread reply) → SMS to John's cell w/ sender + snippet + /cre-os/inbox/[id] deeplink; Prospector lane replies notify w/ property name. Skips STOP/HELP/START and texts from John's own cell (isFromJohn guard on TWILIO_NOTIFY_TO_NUMBER).

**Voice: CODE SHIPPED 7/28, needs one-time activation.** Webhook family at `/api/webhooks/twilio/voice{,/complete,/voicemail,/transcription,/status}` (shared helpers in `src/lib/twilio-voice.ts` + `twilio-webhook.ts`). Flow: inbound call → mirror row in `communications` (ONE row per call, keyed on external_id=CallSid, raw_payload.status walks ringing→answered|voicemail_prompt→voicemail→transcript) → recording disclosure `<Say>` ("this call may be recorded" — REQUIRED for Illinois all-party consent, don't remove while recording is on) → `<Dial>` forwards to John's cell (env `TWILIO_VOICE_FORWARD_TO`, fallback +12197819547, caller-ID passthrough, 20s timeout, `record-from-answer-dual` — answered calls are recorded, audio URL attached to the call's comms row via `/voice/recording` callback under `raw_payload.call_recording_*`; voicemail keys are `recording_*`, they never collide) → unanswered: Polly greeting + `<Record>` (120s max, transcription) → lead found-or-created by phone (same 30-day window as SMS) + SMS notify to John w/ /cre-os/inbox/[id] deeplink. Number-level status callback catches hang-up-during-ring (hottest signal — notifies too). Answered calls log duration and are excluded from Unanswered in metrics.ts + stream (raw_payload.status='answered'). **TO ACTIVATE: visit /api/integrations/twilio/voice-setup (logged in, on the deployed site) to review, then ?apply=true to write voiceUrl + statusCallback onto the number. Then test-call it.** Known tradeoff: if John's carrier voicemail answers before the 20s timeout, Twilio counts it "answered" — if that bites, shorten timeout or add a press-1-to-accept whisper.

**New Communications stream** at `/cre-os/stream` (nav: "Communications") — north-star surface: chronological, day-grouped, filter chips (Unanswered / channel / property / People-only), read-only over `communications`. **7/29: ThreadPanel shipped** — tap a row w/ lead → bottom-sheet/side-panel thread (email+SMS+calls interleaved via GET /api/leads/[id]) + channel-aware reply bar (Text/Email tabs, replies in kind, AI draft pre-loads for email w/ regenerate). All sends via existing lead routes (/send, /send-sms, /draft) so final_sent_at/status/Unanswered stay in sync. **Inbox tab RETIRED from Sidebar + BottomNav 7/29** (John approved after testing the panel); "Comms log" renamed "Outreach tracker" (it's reply-rate/touch-kind/per-property analytics, NOT a duplicate of the stream — don't merge it away). The `/cre-os/inbox` list page + `/cre-os/inbox/[id]` lead files remain ROUTABLE — all SMS deeplinks + in-app lead links depend on [id]; Home/Prospector still link to the old list until Today absorbs Home. Note: Home's `?bucket=hot` param was always ignored by InboxView (known dead param). Design docs (in ~/Documents/Claude/Projects/Commercial Real Estate/): `CRM-North-Star-Architecture.md` (the model: two nouns, one stream, Unanswered = only status, AI draft pre-loaded in reply bar), `CRM-Full-UI-Audit.md` (per-screen verdicts, 16→8 nav, metrics disagreements), `Inbox-Overhaul-Diagnosis.md`, `A2P-SUBMIT-THIS.md`.

**Readability pass (done):** cream tiers now dim 86% / muted 72% / subtle 62% (tailwind.config). `.canvas-light` retargets in globals.css: accent -300/-400 text → deep hues; opacity-40/50/60 clamped to 0.72. ROOT CAUSE was whole-element opacity fades stacking on pastel text — check for that pattern before touching colors again. `metrics.ts` created (canonical hot/unanswered/active-listing/stage defs) — **not yet wired into screens** (Home/Inbox/Properties/Listings/Reports each still compute their own disagreeing numbers).

**Marketing site (stewardshipcre):** SMS consent checkbox live on /contact + inquire flow (`SMS_CONSENT_TEXT` in src/lib/sms-consent.ts — if wording changes, campaign registration must match). Real number on /contact. **STILL BROKEN: /contact form submit is a setTimeout stub — silently discards every lead.** Wire to CRM intake. Consent fields sent by inquire flow are IGNORED by `/api/public/questionnaire` — no consent columns in DB yet.

**Build queue (order):** 1) voice setup + reply notifications, 2) wire screens to metrics.ts, 3) contact dedupe (Al Dziadkowiec ×3, Kamini ×2 — lower(email)/phone match + merge tool), 4) thread view + reply bar w/ AI draft in stream, 5) contact form + consent columns + sms_optouts, 6) Today absorbs Home; Properties absorbs Listings; retire Inbox/Comms log; Prospector launch-or-hide.

**Ops notes:** Twilio balance was ~$1.53 — TOP UP. 11 orphaned Messaging Services (MG…) remain, harmless. Push via `git push origin main` (remote is SSH now; sandbox can't push — John pushes). Netlify env changes need a redeploy to take effect.
