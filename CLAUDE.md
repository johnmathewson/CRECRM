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
comps                -- comparable lease/sale data
deals                -- sales/leasing opportunities (with deal_stages history)
deal_stages          -- deal pipeline state transitions
properties           -- asset inventory (id, name, address, asset_type, status, asking_price, sqft, your_role)
contacts             -- relationship database (full_name, email, phone, warmth, contact_type)
companies            -- vendor/partner entities

RPC: get_assistant_context()  -- SECURITY DEFINER, returns deals/stages/properties/contacts/companies in one call, bypasses RLS
```

**No `database.types.ts` exists.** Types are inferred inline from component state objects.

**Single-user constants** (hardcoded in inserts, see `/src/app/api/intake/save/route.ts:4-5`):
```ts
const ORG_ID  = "a0000000-0000-0000-0000-000000000001"
const USER_ID = "b0000000-0000-0000-0000-000000000001"
```

Use these same constants for any new table inserts.

---

## Auth model

**Supabase email + password**, gated at the middleware layer (`/src/middleware.ts:33-37`). Any route not under `/login` or `/auth` requires a valid session.

**Single user:** John Mathewson (`john@johnmathewson.co`, hardcoded display in `/src/components/nav.tsx:117`).

**To gate a new route** (e.g., `/inbox`): nothing to do. Middleware protects it automatically. Just create `/src/app/inbox/page.tsx`.

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

## Schema additions queued (write as supabase/migrations/0001_leads.sql)

We adopted a `supabase/migrations/` discipline going forward. Existing schema lives in production only; **new schema goes in tracked SQL files first.**

```sql
-- New tables to add
CREATE TYPE lead_source   AS ENUM ('crexi','loopnet','buildout','costar','website','email','phone','sms');
CREATE TYPE lead_intent   AS ENUM ('buy','lease','sell','info');
CREATE TYPE lead_urgency  AS ENUM ('hot','warm','cold');
CREATE TYPE lead_status   AS ENUM ('new','acknowledged','drafted','sent','archived');
CREATE TYPE message_dir   AS ENUM ('inbound','outbound');

CREATE TABLE leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  org_id uuid NOT NULL,
  created_by uuid NOT NULL,
  source lead_source NOT NULL,
  sender_name text,
  sender_email text,
  sender_phone text,
  property_id uuid REFERENCES properties(id) ON DELETE SET NULL,
  property_label text,                  -- "Joliet medical building" (raw mention)
  intent lead_intent,
  urgency lead_urgency DEFAULT 'warm',
  qualifier_summary text,
  raw_email_subject text,
  raw_email_body text,
  claude_extraction jsonb,
  auto_ack_sent_at timestamptz,
  draft_reply text,
  draft_attachments jsonb,
  final_reply text,
  final_sent_at timestamptz,
  status lead_status NOT NULL DEFAULT 'new',
  linked_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  linked_deal_id uuid REFERENCES deals(id) ON DELETE SET NULL
);

CREATE INDEX idx_leads_status_created ON leads (status, created_at DESC);
CREATE INDEX idx_leads_property ON leads (property_id);
CREATE INDEX idx_leads_contact ON leads (linked_contact_id);

CREATE TABLE lead_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now(),
  direction message_dir NOT NULL,
  subject text,
  body text NOT NULL,
  attachments jsonb
);

CREATE INDEX idx_lead_messages_lead ON lead_messages (lead_id, sent_at);
```

**RLS:** existing tables don't use RLS (single-user app, anon key). Match that for now — single user, no need.

---

## Routes to add

| Route | Purpose | Notes |
|---|---|---|
| `/inbox` | Lead list view | Card stack (NOT a table — mobile-first). Sort by `created_at desc`. Status badges. Urgency color (hot=teal, warm=charcoal, cold=muted). |
| `/inbox/[id]` | Lead detail + draft review | Twilio SMS deeplinks land here. Sticky bottom action bar: **Send · Edit · Archive · Promote to Deal**. Thumb-zone buttons. |
| `/api/leads/intake` | Universal ingress endpoint | POSTs from Apps Script (email), Twilio (SMS/voice), public site (form). Branches on `source`. |
| `/api/leads/[id]/send` | Sends final approved reply | Reads possibly-edited `draft_reply`, sends via Gmail API from `john@stewardshipcre.com`, updates `final_reply`, `final_sent_at`, `status='sent'`. |
| `/api/leads/[id]/ack` | Internal — fires the 60-sec auto-receipt | Called by `/intake`. Inserts row in `lead_messages` (direction: outbound). |

Add `/inbox` link to `/src/components/nav.tsx` `links` array (current tabs: Dashboard, Intake, Properties, Contacts, Deals, Reports).

---

## Coding conventions (lock these — they're already in the codebase)

- **kebab-case** filenames (`create-contact-modal.tsx`, `intake-upload-zone.tsx`)
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

1. **Schema migration** — write `supabase/migrations/0001_leads.sql` with the schema above. John runs it once in Supabase Studio.
2. **`/api/leads/intake`** — first deliverable. Mirrors the existing `/api/intake/parse` pattern (raw fetch, JSON-prompt extraction).
3. **`/inbox` UI** — mobile-first card stack list + split detail page with sticky bottom action bar.
4. **Apps Script email watcher** — separate Apps Script project in John's Google Workspace. Polls `inquiries@stewardshipcre.com` every 60s, POSTs new emails to `/api/leads/intake`.
5. **Twilio SMS + voice webhooks** — point at `/api/leads/intake` with `source: 'sms'` / `source: 'phone'`.
6. **Public site contact form** — currently unwired; will POST to this CRM's `/api/leads/intake` once endpoint exists.

---

*Last updated: April 2026. When in doubt, ask John before assuming.*
