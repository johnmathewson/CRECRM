# Identity Consolidation Plan — one canonical contact

**Goal:** make `contacts` the single source of truth for every person. `leads`,
`crexi_leads_state`, and `communications` should *reference* a contact by
`contact_id`, not carry their own editable copy of name / email / phone.

**Status going in:** the data was reconciled on 2026-06-03 (emails 100% linked,
every Crexi lead now has a contact, 14 missing contacts created). This plan
changes the *model* so the tables can't drift apart again.

**Guiding rule (already in CLAUDE.md, 2026-05-15):** every Crexi-sourced lead
must end up as a row in `contacts`. This plan extends that rule to *every*
person-bearing table and enforces it at the database level.

---

## The core decision: reference vs. raw-capture

We are **not** deleting `leads.sender_email`, `crexi_leads_state.email`, etc.
Those record *what actually arrived* on a specific inbound — which can legitimately
differ from a contact's primary email (a buyer emails from a personal address,
the contact is filed under their work address). Throwing them away loses the audit
trail and breaks the SENT-sync matcher that keys on `leads.sender_email`.

Instead we draw a hard line:

- **Identity / display fields** (the name, email, phone you *show* and *edit*)
  live **only** on `contacts`. Every screen reads them via the `contact_id` join.
- **Raw-capture fields** on `leads` / `crexi_leads_state` become *immutable,
  as-received* values. They are never shown as "the contact's email" and never
  edited in place. They exist for matching and audit only.

So consolidation = (1) guarantee every row links, (2) enforce it forever, and
(3) move every *read* of identity onto the contact join.

---

## Phase 0 — Safety net (do first, ~5 min, zero downtime)

Prevent new duplicate contacts before anything else changes.

```sql
-- One contact per email per org. (Today there are 0 dup emails, so this is safe.)
CREATE UNIQUE INDEX CONCURRENTLY uq_contacts_org_email
  ON contacts (organization_id, lower(email))
  WHERE email IS NOT NULL AND email <> '';

-- Index the reference columns we're about to lean on (these FKs are unindexed today).
CREATE INDEX CONCURRENTLY idx_leads_contact_id        ON leads (contact_id);
CREATE INDEX CONCURRENTLY idx_crexi_contact_id         ON crexi_leads_state (contact_id);
CREATE INDEX CONCURRENTLY idx_communications_contact_id ON communications (contact_id);
```

**Rollback:** `DROP INDEX` — indexes are non-destructive.
**Verify:** the unique index creation fails loudly if any duplicate emails exist;
if it does, dedupe those contacts first (none exist as of 2026-06-03).

---

## Phase 1 — Guarantee linkage at every ingest path (code)

Make `findOrCreateContact()` the **only** way a person enters the system, then
stamp the resulting `contact_id` on the lead / crexi / communication row.

`findOrCreateContact` already does the right thing (email canonical → phone
fallback → create, with COALESCE backfill). It just isn't called from every path,
and some paths that match a contact forget to write the id (the bug we already
fixed in `poll-gmail` sent-sync).

**Touch points to audit** (every file that writes a person-bearing row):

| Path | File | Action |
|---|---|---|
| Email intake | `src/app/api/leads/intake/route.ts` | resolve contact, set `leads.contact_id` |
| Crexi XLSX report | `src/app/api/leads/crexi-report/route.ts` | already targeted by open thread #7 — finish find-or-create + set `crexi_leads_state.contact_id` |
| Crexi extension scrape | `src/app/api/extension/crexi-leads/route.ts` | same; XLSX remains source of truth |
| Crexi bulk import | `src/app/api/leads/bulk-import-crexi/route.ts` | same |
| Gmail poll (inbound + SENT-sync) | `src/app/api/cron/poll-gmail/route.ts` | ✅ contact_id on outbound fixed 2026-06-03; verify inbound path too |
| Twilio SMS | `src/app/api/webhooks/twilio/sms/route.ts` | resolve contact by phone, set `communications.contact_id` |
| Public forms | `src/app/api/public/questionnaire/route.ts`, NDA, owner | resolve contact, link |
| Promote / send / ack | `src/app/api/leads/[id]/{promote,send,ack}/route.ts` | carry contact_id through |

**Pattern for every path:**
```ts
const r = await findOrCreateContact(sb, { name, email, phone, role, company, levelOfInterest });
if ("error" in r) { /* log + skip — do NOT insert an orphan */ }
else { await sb.from(table).insert({ ...row, contact_id: r.contactId }); }
```

**Risk:** low — `findOrCreateContact` is idempotent. The main hazard is the
phone-fallback over-merging two people who share a switchboard number; email
always wins, so keep email as the primary key and treat phone matches as
best-effort.

---

## Phase 2 — Move every READ onto the contact join (code)

This is the step that actually makes the contact "the source of truth." Today
many screens display `lead.sender_name` / `crexi.name` directly. Switch them to
read identity from the joined contact, falling back to raw capture only when
`contact_id` is somehow null (shouldn't happen after Phase 3).

- Centralize in the query layer so UI components don't each re-implement it:
  `src/lib/cre-os/inbox-queries.ts`, `property-leads-queries.ts`,
  `relationship-queries.ts`, `queries.ts`.
- Select shape becomes e.g.:
  ```ts
  .select("id, status, urgency, raw_subject, contact:contact_id (id, full_name, email, phone, warmth)")
  ```
- Display name = `row.contact?.full_name ?? row.sender_name` (fallback only).
- Components to update: `ContactDrawer.tsx`, `agent-dashboard-content.tsx`,
  `PerformanceTab.tsx`, and the inbox/lead lists.

**Risk:** medium — it's the widest change (≈20 files), but each edit is
mechanical and individually testable. Do it table-by-table (leads first, then
crexi) so you can ship and verify incrementally.

---

## Phase 3 — Enforce it at the database (do after Phases 1–2 are live)

Once every path guarantees a `contact_id`, make the database refuse orphans.

```sql
-- Backfill check first — must return 0 before adding the constraints.
SELECT
  (SELECT count(*) FROM leads WHERE contact_id IS NULL) AS leads_orphan,
  (SELECT count(*) FROM crexi_leads_state WHERE contact_id IS NULL) AS crexi_orphan;

-- The 1 remaining orphan lead has no email — resolve or archive it, then:
ALTER TABLE crexi_leads_state ALTER COLUMN contact_id SET NOT NULL;
ALTER TABLE leads             ALTER COLUMN contact_id SET NOT NULL;
-- communications.contact_id stays NULLABLE: some system mail has no human
-- counterparty (e.g., inbound with no parseable sender). Guard in app instead.
```

**Rollback:** `ALTER COLUMN ... DROP NOT NULL`.
**Verify:** ingest a test lead through each path; confirm the row lands with a
contact_id and the screens render the contact's name.

---

## Phase 4 — Optional cleanup (later, low priority)

- Add a convenience view for the inbox so the UI never thinks about joins:
  ```sql
  CREATE VIEW lead_inbox AS
  SELECT l.*, c.full_name, c.email AS contact_email, c.phone AS contact_phone, c.warmth
  FROM leads l LEFT JOIN contacts c ON c.id = l.contact_id;
  ```
- Rename raw-capture columns to signal intent (`sender_email` → `raw_sender_email`)
  so no one mistakes them for the canonical value. Cosmetic; defer until Phases
  1–3 are stable.
- Consider folding `crexi_leads_state` from a parallel person-store into a pure
  per-listing engagement cache keyed by `(property_id, contact_id)` — it already
  trends that way.

---

## Sequencing & effort

1. **Phase 0** — 5 min, apply now, fully reversible.
2. **Phase 1** — ~half a day; finishes open-thread #7 along the way.
3. **Phase 2** — ~1 day, shippable table-by-table.
4. **Phase 3** — 15 min once #1–2 are verified in production.
5. **Phase 4** — whenever; nice-to-have.

Each phase is independently deployable and reversible. Nothing here drops data.

---

## What I can do next

- Apply **Phase 0** now (safe, reversible) and write it as a numbered migration
  in `supabase/migrations/`.
- Or start **Phase 1** by auditing each ingest route and wiring `findOrCreateContact`
  where it's missing, one PR at a time.

*Drafted 2026-06-03. No schema changes applied yet — this is the plan for review.*
