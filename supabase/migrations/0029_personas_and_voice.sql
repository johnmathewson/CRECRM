-- 0029_personas_and_voice.sql
--
-- The Prospector agent's brain, persisted.
--
-- Before this migration, the agent's voice was a hardcoded switch statement
-- in src/lib/cre-os/ai-touch-personalize.ts. Editing it required code change,
-- commit, push, Netlify rebuild — minutes of friction per tweak.
--
-- After: voice + skill lives in `personas` rows. The Prospector picks the
-- right persona based on the lane's archetype (e.g. "listing_inquiry" for
-- buyer-side warm follow-up, "pre_foreclosure" for distressed-owner cold
-- outreach). Editing a persona's voice/skill instantly affects every future
-- AI draft using that persona, across all current and future lanes/listings.
--
-- Architecture commitment (2026-05-15):
--   Personas are tied to WORKFLOW TYPE, not specific properties or lanes.
--   One "Listing Inquiry" persona handles ALL buyers on ALL our listings,
--   present and future. The agent reads property metadata at runtime from
--   the properties table — properties are inventory, personas are
--   identity. Don't conflate them.
--
-- Adds:
--   personas                    — editable persona definitions (one row per archetype)
--   broker_voice_profile        — global broker voice (single row per org)
--   lanes.persona_id            — which persona drives this lane
--   properties.marketing_notes  — optional per-listing anchor intel
--   voice_examples              — auto-captured sent emails for few-shot retrieval

-- ── 1. personas ─────────────────────────────────────────────────────────
-- Each persona is an editable "way of speaking" — voice profile + skill profile +
-- the system-prompt section that explains the angle. Currently seeded from the
-- hardcoded archetypeAngle() switch; user can edit any field anytime.
CREATE TABLE IF NOT EXISTS personas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  slug text NOT NULL,
  name text NOT NULL,
  description text,
  -- The main system-prompt block explaining the angle. Editable prose.
  angle_prompt text NOT NULL,
  -- voice_profile structure (all optional, all arrays of strings except tone):
  --   { pet_phrases: ["talk soon", "the math pencils"],
  --     banned_phrases: ["reaching out", "wanted to start a conversation"],
  --     tone: "warm but direct",
  --     structure_rules: ["max 3 short paragraphs", "open with engagement signal"],
  --     sign_off: "Talk soon, John" }
  voice_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- skill_profile structure:
  --   { audience: "Hospitality investors, CCIM brokers...",
  --     recipient_assumptions: "They've signed the CA; assume sophistication.",
  --     dos: ["offer rent roll Q&A", "mention 8.69% cap"],
  --     donts: ["quote price unsolicited", "explain hospitality 101"],
  --     conversion_goal: "Get to a tour OR Q&A call OR written question" }
  skill_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, slug)
);

CREATE INDEX IF NOT EXISTS personas_org_active_idx ON personas (organization_id, is_active);

COMMENT ON TABLE personas IS
  'Editable persona definitions — voice + skill profile + angle prompt. Replaces the hardcoded archetypeAngle() switch in code. One persona handles all listings/lanes using that archetype.';

-- ── 2. broker_voice_profile ─────────────────────────────────────────────
-- Single row per org. The broker's global identity that gets injected into
-- every draft regardless of which persona is active.
CREATE TABLE IF NOT EXISTS broker_voice_profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL UNIQUE,
  bio text,                                 -- "John is a 20-year CRE broker..."
  brand_voice text,                         -- "Direct, Midwest, numbers-forward, no fluff"
  pet_phrases jsonb NOT NULL DEFAULT '[]'::jsonb,
  banned_phrases jsonb NOT NULL DEFAULT '[]'::jsonb,
  always_do jsonb NOT NULL DEFAULT '[]'::jsonb,
  never_do jsonb NOT NULL DEFAULT '[]'::jsonb,
  sign_off_default text,                    -- "Talk soon, John"
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE broker_voice_profile IS
  'Single-row-per-org global broker voice. Gets injected into every AI draft regardless of persona. Captures bio, brand voice, pet/banned phrases, sign-off.';

-- ── 3. lanes.persona_id ─────────────────────────────────────────────────
-- Each lane gets a persona. Allows many lanes to share one persona (and
-- benefit from edits) while keeping lane-level overrides for cadence/timing/
-- targeting separate from voice/skill.
ALTER TABLE lanes
  ADD COLUMN IF NOT EXISTS persona_id uuid REFERENCES personas(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS lanes_persona_id_idx ON lanes (persona_id);

COMMENT ON COLUMN lanes.persona_id IS
  'Persona driving this lane. NULL = use the lane''s trigger_type to look up a persona by slug (legacy fallback).';

-- ── 4. properties.marketing_notes ───────────────────────────────────────
-- Optional free-form text per property. Injected into prompts when the AI
-- is drafting outreach about this specific property. Use cases:
--   - "Lead with the 8.69% cap, not the asking price"
--   - "Owner motivated for 60-day close — mention only on inbound interest"
--   - "Patel buyer pool is hot here, assume hospitality fluency"
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS marketing_notes text;

COMMENT ON COLUMN properties.marketing_notes IS
  'Optional anchor intel for AI drafts about this property. Plain text. Gets injected into the prompt when this property is the subject.';

-- ── 5. voice_examples ───────────────────────────────────────────────────
-- Every email the broker sends through the CRM is captured here for few-shot
-- retrieval on future drafts. The voice gets sharper over time without the
-- broker writing any rules.
CREATE TABLE IF NOT EXISTS voice_examples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  persona_id uuid REFERENCES personas(id) ON DELETE SET NULL,
  property_id uuid REFERENCES properties(id) ON DELETE SET NULL,
  channel text NOT NULL CHECK (channel IN ('email','sms')),
  subject text,
  body text NOT NULL,
  -- How was this email produced?
  --   "ai_drafted"  — AI drafted, broker sent without edits
  --   "ai_edited"   — AI drafted, broker edited before sending
  --   "manual"      — broker wrote from scratch
  source text NOT NULL CHECK (source IN ('ai_drafted','ai_edited','manual')),
  -- For ai_edited: what did the broker change? Useful for analyzing voice drift.
  user_edits_diff text,
  -- The recipient's engagement signal (e.g. "Executed CA", "Visited Page", "Replied")
  recipient_engagement text,
  -- Free-form recipient profile snapshot for retrieval relevance
  recipient_profile_snapshot jsonb,
  sent_at timestamptz NOT NULL,
  is_starred boolean NOT NULL DEFAULT false,
  is_blocked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS voice_examples_lookup_idx
  ON voice_examples (organization_id, persona_id, sent_at DESC)
  WHERE is_blocked = false;

CREATE INDEX IF NOT EXISTS voice_examples_property_idx
  ON voice_examples (property_id, sent_at DESC)
  WHERE is_blocked = false;

COMMENT ON TABLE voice_examples IS
  'Auto-captured sent emails for few-shot retrieval. Drafts in the Prospector pull the top-N similar examples by persona + property + engagement signal. Starred examples preferred. Blocked examples excluded.';

-- ── 6. Seed personas with existing archetype content ────────────────────
-- These mirror the hardcoded archetypeAngle() switch in
-- src/lib/cre-os/ai-touch-personalize.ts. After this seed, the personalizer
-- can read from DB instead of from the switch — and the broker can edit
-- any of them via the UI.
INSERT INTO personas (organization_id, slug, name, description, angle_prompt, voice_profile, skill_profile)
VALUES
  ('a0000000-0000-0000-0000-000000000001'::uuid,
   'listing_inquiry_followup',
   'Listing Inquiry Buyers',
   'Buyers/brokers who engaged with one of our active listings on CREXi (signed CA, downloaded OM, requested info, multiple page visits). We are the LISTING BROKER — they are prospective buyers who came to us.',
   $angle$CRITICAL FRAMING — read carefully:
- The PROPERTY listed below is being SOLD by the sender (John, Stewardship CRE is the LISTING BROKER representing the seller).
- The RECIPIENT below is a PROSPECTIVE BUYER who engaged with the listing on CREXi (signed a confidentiality agreement, downloaded the OM, requested information, or visited the listing page multiple times).
- The recipient came to US. We did NOT cold-prospect them. DO NOT use cold-outreach language like "I came across [property]", "wanted to start a conversation", "would you be open to a 5-minute call". That framing is wrong and will burn the lead.
- Instead: open by referencing their SPECIFIC engagement signal (e.g. "Saw you signed the CA on Liberty Square Tuesday", "Noticed you've been back to the listing a few times", "Thanks for downloading the OM on [property]").
- The value prop is helping them get the underwriting answers or property access they need to MAKE AN OFFER. Offer one concrete next step: a walk-through tour, a Q&A call on the rent roll / cap rate / deferred maintenance, an introduction to the asset manager, or the data room.
- DO NOT pitch them on selling their OWN property. They are the buyer side here. Confusing the direction will read as bot-generated and destroy trust.
- Sign off as John Mathewson, the listing broker.$angle$,
   '{}'::jsonb, '{}'::jsonb),

  ('a0000000-0000-0000-0000-000000000001'::uuid,
   'pre_foreclosure',
   'Pre-Foreclosure Owners',
   'Owners with active lis pendens, notice of default, or notice of trustee sale filings. Time-pressured exit decisions.',
   $angle$This owner is in pre-foreclosure (lis pendens, NOD, or NTS filed). They likely face an emotional, time-pressured situation. Lead with empathy and a no-pressure exit option. The value prop is preserving equity before forced sale.$angle$,
   '{}'::jsonb, '{}'::jsonb),

  ('a0000000-0000-0000-0000-000000000001'::uuid,
   'refi_maturity',
   'Refi Maturity Owners',
   'Owners with commercial loans maturing in the next 12-24 months. Facing rate-environment cash-in pressure at refinance.',
   $angle$This owner has a commercial loan maturing in the near term (typically 12-24 months). Their refi at today''s higher rates may require a cash-in scenario. Lead with the math: their loan, today''s rates, the cash gap. The value prop is helping them avoid writing a check at refi.$angle$,
   '{}'::jsonb, '{}'::jsonb),

  ('a0000000-0000-0000-0000-000000000001'::uuid,
   'tired_owner',
   'Tired Owners',
   'Long-hold (15+ years) absentee or out-of-state owners. Tax-motivated exits often via 1031 or generational transfer.',
   $angle$This owner has held the property 15+ years, often as an absentee landlord or out-of-state. They may be tax-motivated to exit. Lead with the 1031 exchange framing or generational succession. The value prop is a tax-efficient exit while their basis is still attractive.$angle$,
   '{}'::jsonb, '{}'::jsonb),

  ('a0000000-0000-0000-0000-000000000001'::uuid,
   'failed_listing',
   'Failed Listing Owners',
   'Owners whose recent listing was pulled or expired without selling. Often discouraged but still motivated.',
   $angle$This property was on market recently but pulled or never sold. The owner may be discouraged but still motivated. Lead by acknowledging the prior listing without judgment. The value prop is a fresh strategy or specific buyer.$angle$,
   '{}'::jsonb, '{}'::jsonb),

  ('a0000000-0000-0000-0000-000000000001'::uuid,
   'below_market_rent',
   'Below-Market-Rent Owners',
   'Owners whose in-place rents are materially below market. Often unaware of the gap they''re leaving on the table.',
   $angle$This property''s in-place rent is well below market. Owner may not realize the gap. Lead with the specific delta in numbers ($X in-place vs $Y market). The value prop is unlocking the value either through a lift or through a buyer who will.$angle$,
   '{}'::jsonb, '{}'::jsonb),

  ('a0000000-0000-0000-0000-000000000001'::uuid,
   'probate',
   'Probate / Inherited Property',
   'Property in active probate or recently transferred via inheritance. Heirs often want a clean settlement.',
   $angle$This property is in probate or recently transferred via inheritance. The heirs may want to sell quickly to settle the estate. Lead with discretion and respect for the family situation. The value prop is a clean, tax-efficient sale that simplifies estate settlement.$angle$,
   '{}'::jsonb, '{}'::jsonb),

  ('a0000000-0000-0000-0000-000000000001'::uuid,
   'warm_lead_followup',
   'Warm Lead Follow-up (Generic)',
   'Generic warm-lead follow-up persona for engagement signals where direction (buyer vs owner) is unclear. Prefer listing_inquiry_followup when the engagement was on one of our listings.',
   $angle$This person already engaged with one of our active listings (viewed, downloaded OM, signed CA, or inquired). They''ve shown intent. Lead with their specific engagement and pick up the conversation. The value prop is helping them get the info or answer they need to make a decision.$angle$,
   '{}'::jsonb, '{}'::jsonb),

  ('a0000000-0000-0000-0000-000000000001'::uuid,
   'generic',
   'Generic Outreach',
   'Catch-all fallback when no specific archetype fits. Used by manual one-off compose dialogs without a clear lane context.',
   $angle$Generic outreach to a property owner or prospect. Keep it brief and specific to whatever property data is available.$angle$,
   '{}'::jsonb, '{}'::jsonb)
ON CONFLICT (organization_id, slug) DO NOTHING;

-- ── 7. Seed an empty broker_voice_profile row so the UI has a row to edit ──
INSERT INTO broker_voice_profile (organization_id, brand_voice, sign_off_default)
VALUES (
  'a0000000-0000-0000-0000-000000000001'::uuid,
  'Direct, Midwestern, numbers-forward. Plain English. No sales clichés. No fluff. Specific to what the recipient actually said or did.',
  '— John'
)
ON CONFLICT (organization_id) DO NOTHING;
