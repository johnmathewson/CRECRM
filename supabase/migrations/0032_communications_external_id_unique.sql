-- Prevent sent-sync duplication.
--
-- Background: the poll-gmail SENT sync deduped by checking for an existing
-- communications row with the same external_id, but the check used
-- .maybeSingle() with no LIMIT. Concurrent polls (the cron fires every minute)
-- raced past the check and seeded duplicates; once >1 row shared an external_id
-- the check itself threw, flipping the guard to "not logged" and re-inserting
-- on every run. 313 real sent emails had ballooned to ~92k rows.
--
-- The application guard is fixed (LIMIT 1), and existing duplicates were
-- collapsed to one row per external_id. This index is the durable backstop:
-- the database now refuses a second row for the same message id.
--
-- Partial (WHERE external_id IS NOT NULL) so rows without a provider message id
-- (e.g. an inbound with an unparseable id) are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS uq_communications_external_id
  ON communications (external_id)
  WHERE external_id IS NOT NULL;
