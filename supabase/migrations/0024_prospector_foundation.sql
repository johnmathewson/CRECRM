-- 0024_prospector_foundation.sql
--
-- Prospector — phase 1 of the prospecting agent.
--
-- The Prospector mines off-market commercial properties (cold inventory),
-- enrolls them in lanes (Pre-foreclosure, Refi maturity, Tired owner, etc.),
-- runs cadenced outreach, and surfaces hot replies for manual promotion
-- into the warm Properties pipeline.
--
-- Architectural choice: ONE properties table for both cold and warm.
-- Cold = status='prospect' (filtered out of the Properties view by default,
-- visible only in the Prospector). Warm = anything else (idea, prospecting,
-- pitched, listed, ...). Promotion is a one-way door: when a prospect
-- engages, status flips to 'prospecting' and the existing pipeline takes
-- over. No data migration on promotion — every prior touch already
-- foreign-keys to property_id.
--
-- Reuses existing infrastructure:
--   • signals + signal_actions (foreclosure / refi-maturity / etc. flags)
--   • import_jobs (audit log for CoStar/PropStream uploads)
--   • activities (touches written here once sent, threading to the
--     property + contact timeline)

-- ─── 1. Widen properties.status to include 'prospect' ─────────────────────
ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_status_check;
ALTER TABLE properties ADD CONSTRAINT properties_status_check
  CHECK (status = ANY (ARRAY[
    'prospect'::text,        -- NEW: cold inventory, Prospector-only
    'idea'::text,
    'prospecting'::text,
    'pitched'::text,
    'listed'::text,
    'under_contract'::text,
    'leased'::text,
    'sold'::text,
    'closed'::text,
    'dead'::text,
    'pre_listing'::text,
    'for_lease'::text,
    'off_market'::text
  ]));

-- ─── 2. Prospect-specific columns on properties ───────────────────────────
-- These come from CoStar (universe) and PropStream (signals) imports. They
-- support the lane filter dimensions and the trigger engine.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS apn text;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS county text;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS sub_type text;            -- garden / NNN / single-tenant / etc.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS units integer;            -- for multifamily

-- Owner identity (LLC-name as it appears on records; gets unmasked into a
-- contact via skip-trace later)
ALTER TABLE properties ADD COLUMN IF NOT EXISTS owner_name_raw text;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS owner_type text;          -- individual | llc | trust | institutional
ALTER TABLE properties ADD COLUMN IF NOT EXISTS owner_state text;         -- registration state
ALTER TABLE properties ADD COLUMN IF NOT EXISTS owner_mailing_address text;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS owner_mailing_city text;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS owner_mailing_state text;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS owner_mailing_zip text;

-- Sale history
ALTER TABLE properties ADD COLUMN IF NOT EXISTS last_sale_date date;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS last_sale_price numeric;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS years_owned integer;      -- derived; refreshed at import

-- Debt — feeds Lane B (refi maturity) without skip-trace
ALTER TABLE properties ADD COLUMN IF NOT EXISTS mortgage_origination_date date;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS mortgage_maturity_date date;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS mortgage_lender text;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS mortgage_balance numeric;

-- Valuation hint from data provider (CoStar estimate, PropStream AVM)
ALTER TABLE properties ADD COLUMN IF NOT EXISTS estimated_value numeric;

-- Prospector roll-up (denormalized for fast filtering)
ALTER TABLE properties ADD COLUMN IF NOT EXISTS prospector_score numeric;        -- 0-100 composite
ALTER TABLE properties ADD COLUMN IF NOT EXISTS prospector_signal_flags jsonb DEFAULT '[]'::jsonb;
                                                                          -- e.g. ['pre_foreclosure','tax_delinquent','refi_maturing_12mo']

-- Indexes for common filter paths
CREATE INDEX IF NOT EXISTS properties_apn_idx ON properties(apn) WHERE apn IS NOT NULL;
CREATE INDEX IF NOT EXISTS properties_county_idx ON properties(county) WHERE county IS NOT NULL;
CREATE INDEX IF NOT EXISTS properties_status_prospect_idx ON properties(organization_id, status) WHERE status = 'prospect';
CREATE INDEX IF NOT EXISTS properties_owner_state_idx ON properties(owner_state) WHERE owner_state IS NOT NULL;
CREATE INDEX IF NOT EXISTS properties_signal_flags_gin ON properties USING gin (prospector_signal_flags);
CREATE INDEX IF NOT EXISTS properties_mortgage_maturity_idx ON properties(mortgage_maturity_date) WHERE mortgage_maturity_date IS NOT NULL;

-- ─── 3. Lanes — saved configurations for prospecting plays ────────────────
-- Each lane is a (universe filter + trigger + cadence + governor) bundle.
-- Cadence and filters live in JSONB so the schema doesn't sprawl as you
-- iterate. The trigger engine reads these and picks matching properties.
CREATE TABLE IF NOT EXISTS lanes (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  name            text NOT NULL,
  description     text,
  status          text NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft', 'active', 'paused', 'archived')),

  -- Trigger archetype — controls which signal flags qualify a property.
  -- A value of 'custom' means the lane is purely filter-driven (no
  -- signal-flag prerequisite).
  trigger_type    text NOT NULL
                   CHECK (trigger_type IN ('pre_foreclosure', 'refi_maturity', 'tired_owner',
                                            'failed_listing', 'below_market_rent', 'probate',
                                            'custom')),

  -- Universe + owner + trigger filters. Schema:
  -- {
  --   "asset_types": ["multifamily","retail",...],
  --   "sub_types": [...],
  --   "counties": ["Lake IN","Cook IL",...],
  --   "sqft_min": 5000, "sqft_max": 150000,
  --   "value_min": 500000, "value_max": 5000000,
  --   "units_min": 10, "units_max": 200,
  --   "year_built_min": 1950, "year_built_max": null,
  --   "owner_types": ["llc","individual"],
  --   "min_years_owned": 15,
  --   "owner_out_of_state": true,
  --   "trigger_window_months": 24,           -- for refi_maturity
  --   "trigger_origination_year_min": 2015,
  --   ...
  -- }
  filters         jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Sequence of cadence steps. Each step:
  -- { "day_offset": 0, "channel": "letter", "template": "lane-b-letter-v1" }
  cadence         jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Per-channel approval mode: 'auto' (send without review),
  -- 'queue' (require human approval), 'manual' (human authors)
  approval_mode   jsonb NOT NULL DEFAULT
                   '{"email":"queue","sms":"queue","call":"manual","letter":"auto","voicemail":"manual"}'::jsonb,

  -- Volume governors
  daily_touch_cap        integer NOT NULL DEFAULT 50,
  weekly_enrollment_cap  integer NOT NULL DEFAULT 25,

  -- Telemetry counters (updated by triggers / queries)
  total_enrolled         integer NOT NULL DEFAULT 0,
  total_touched          integer NOT NULL DEFAULT 0,
  total_responded        integer NOT NULL DEFAULT 0,
  total_promoted         integer NOT NULL DEFAULT 0,

  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lanes_org_status_idx ON lanes(organization_id, status);

ALTER TABLE lanes ENABLE ROW LEVEL SECURITY;

-- ─── 4. Lane enrollments — one row per (property, lane) being worked ──────
CREATE TABLE IF NOT EXISTS lane_enrollments (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lane_id         uuid NOT NULL REFERENCES lanes(id) ON DELETE CASCADE,
  property_id     uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,

  status          text NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'paused', 'engaged',
                                     'exited_no_response', 'exited_dnc',
                                     'exited_disqualified', 'promoted')),

  current_step    integer NOT NULL DEFAULT 0,    -- index into lanes.cadence
  next_action_at  timestamptz,                    -- when the next step fires

  enrolled_at     timestamptz NOT NULL DEFAULT now(),
  exited_at       timestamptz,
  exit_reason     text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, lane_id, property_id)
);

CREATE INDEX IF NOT EXISTS lane_enrollments_lane_status_idx
  ON lane_enrollments(lane_id, status);
CREATE INDEX IF NOT EXISTS lane_enrollments_property_idx
  ON lane_enrollments(property_id);
CREATE INDEX IF NOT EXISTS lane_enrollments_next_action_idx
  ON lane_enrollments(next_action_at)
  WHERE status = 'active' AND next_action_at IS NOT NULL;

ALTER TABLE lane_enrollments ENABLE ROW LEVEL SECURITY;

-- ─── 5. Lane touches — every cadence touch (queued / drafted / sent / ...) ─
-- A touch is the physical artifact: an email draft, an SMS body, a call
-- log. Once sent, the corresponding row in `activities` gets created and
-- linked via activity_id so the property workspace timeline shows a unified
-- view of all communication, agent and human alike.
CREATE TABLE IF NOT EXISTS lane_touches (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  enrollment_id   uuid NOT NULL REFERENCES lane_enrollments(id) ON DELETE CASCADE,
  lane_id         uuid NOT NULL REFERENCES lanes(id) ON DELETE CASCADE,
  property_id     uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  contact_id      uuid REFERENCES contacts(id) ON DELETE SET NULL,

  step_index      integer NOT NULL,
  channel         text NOT NULL CHECK (channel IN ('email', 'sms', 'call', 'letter', 'voicemail')),
  status          text NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued', 'drafted', 'approved', 'sent',
                                     'failed', 'skipped', 'responded')),

  scheduled_at    timestamptz,
  sent_at         timestamptz,
  responded_at    timestamptz,

  subject         text,    -- email subject, SMS preview, etc.
  body            text,
  metadata        jsonb DEFAULT '{}'::jsonb,

  -- Once sent, link to the activity record on the property timeline
  activity_id     uuid REFERENCES activities(id) ON DELETE SET NULL,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lane_touches_enrollment_idx ON lane_touches(enrollment_id);
CREATE INDEX IF NOT EXISTS lane_touches_status_idx ON lane_touches(organization_id, status);
CREATE INDEX IF NOT EXISTS lane_touches_scheduled_idx ON lane_touches(scheduled_at)
  WHERE status IN ('queued', 'drafted', 'approved');
CREATE INDEX IF NOT EXISTS lane_touches_property_idx ON lane_touches(property_id);

ALTER TABLE lane_touches ENABLE ROW LEVEL SECURITY;

-- ─── 6. updated_at triggers (idempotent) ──────────────────────────────────
-- Reuse trigger_set_updated_at if it already exists; otherwise create.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'trigger_set_updated_at'
  ) THEN
    CREATE FUNCTION trigger_set_updated_at()
    RETURNS TRIGGER AS $func$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $func$ LANGUAGE plpgsql;
  END IF;
END $$;

DROP TRIGGER IF EXISTS lanes_updated_at ON lanes;
CREATE TRIGGER lanes_updated_at BEFORE UPDATE ON lanes
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

DROP TRIGGER IF EXISTS lane_enrollments_updated_at ON lane_enrollments;
CREATE TRIGGER lane_enrollments_updated_at BEFORE UPDATE ON lane_enrollments
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

DROP TRIGGER IF EXISTS lane_touches_updated_at ON lane_touches;
CREATE TRIGGER lane_touches_updated_at BEFORE UPDATE ON lane_touches
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
