-- 0026_lane_touches_allow_manual_sends.sql
--
-- Make lane_touches.enrollment_id + lane_id nullable so the "Send touch
-- now" UI action (manual one-off email from a cold-inventory row) can
-- log into lane_touches alongside cadence-driven sends. Lets the
-- Prospector Inbox show one unified stream — agent autopilot + manual.
--
-- Existing rows always have both populated (only the cadence runner
-- writes when both are present), so this is purely additive.
--
-- Applied via Supabase MCP on 2026-05-11.

ALTER TABLE lane_touches ALTER COLUMN enrollment_id DROP NOT NULL;
ALTER TABLE lane_touches ALTER COLUMN lane_id DROP NOT NULL;
