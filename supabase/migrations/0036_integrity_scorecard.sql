-- 0036 — integrity_scorecard(): the standing health check for the record.
--
-- Every count must read zero. Surfaced on Settings → Integrity and checked
-- nightly (netlify/functions/integrity-nightly.ts → POST /api/integrity),
-- which texts John when anything is non-zero or an alarm fired in the
-- last 24 hours. Migration 0035's constraints make most of these
-- impossible for new rows; the scorecard proves it stays that way and
-- catches the operational ones (acks, alarms) the DB can't express.
--
-- Applied via Supabase MCP on 2026-10-13.

CREATE OR REPLACE FUNCTION integrity_scorecard() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT jsonb_build_object(
    'checked_at', now(),
    'checks', jsonb_build_array(
      jsonb_build_object('key','comms_no_person','label','Messages with no person',
        'count',(SELECT count(*) FROM communications WHERE contact_id IS NULL AND coalesce(touch_kind,'') <> 'internal')),
      jsonb_build_object('key','comms_no_external_id','label','Messages with no external id',
        'count',(SELECT count(*) FROM communications WHERE external_id IS NULL)),
      jsonb_build_object('key','inbound_from_us','label','Our own mail logged as inbound',
        'count',(SELECT count(*) FROM communications c WHERE c.direction = 'inbound'
                   AND lower(coalesce(c.from_address,'')) IN (SELECT lower(email) FROM gmail_oauth_tokens WHERE revoked_at IS NULL))),
      jsonb_build_object('key','signals_in_comms','label','CREXi signals stored as messages',
        'count',(SELECT count(*) FROM communications WHERE raw_payload->>'source' = 'crexi_report' OR subject LIKE 'CREXi activity%')),
      jsonb_build_object('key','leads_no_person','label','Open leads with no person',
        'count',(SELECT count(*) FROM leads WHERE contact_id IS NULL AND status NOT IN ('spam','archived','unmatched'))),
      jsonb_build_object('key','dup_open_leads','label','Duplicate open leads (person + property)',
        'count',(SELECT count(*) FROM (SELECT contact_id, property_id FROM leads
                   WHERE contact_id IS NOT NULL AND property_id IS NOT NULL
                     AND status NOT IN ('archived','spam','converted','promoted','dead')
                   GROUP BY 1,2 HAVING count(*) > 1) d)),
      jsonb_build_object('key','bad_phones','label','Phones not E.164',
        'count',(SELECT (SELECT count(*) FROM contacts WHERE phone IS NOT NULL AND phone !~ '^\+[1-9]\d{9,14}$')
                      + (SELECT count(*) FROM leads WHERE sender_phone IS NOT NULL AND sender_phone !~ '^\+[1-9]\d{9,14}$'))),
      jsonb_build_object('key','bad_emails','label','Emails not lowercase',
        'count',(SELECT (SELECT count(*) FROM contacts WHERE email IS NOT NULL AND email <> lower(trim(email)))
                      + (SELECT count(*) FROM leads WHERE sender_email IS NOT NULL AND sender_email <> lower(trim(sender_email))))),
      jsonb_build_object('key','unmatched_leads','label','Inbound with no identifiable sender (unmatched)',
        'count',(SELECT count(*) FROM leads WHERE status = 'unmatched' AND contact_id IS NULL)),
      jsonb_build_object('key','acks_gave_up','label','Auto-acks that gave up',
        'count',(SELECT count(*) FROM scheduled_acks WHERE sent_at IS NULL AND attempts >= 3)),
      jsonb_build_object('key','acks_stuck','label','Auto-acks waiting over 15 minutes',
        'count',(SELECT count(*) FROM scheduled_acks WHERE sent_at IS NULL AND attempts < 3 AND send_after < now() - interval '15 minutes')),
      jsonb_build_object('key','alarms_24h','label','Alarms in the last 24 hours',
        'count',(SELECT count(*) FROM email_ingest_log WHERE disposition = 'alarm' AND occurred_at > now() - interval '24 hours'))
    ),
    'alarms', (SELECT coalesce(jsonb_agg(jsonb_build_object('at', a.occurred_at, 'kind', a.detail->>'kind', 'message', a.subject, 'detail', a.detail) ORDER BY a.occurred_at DESC), '[]'::jsonb)
               FROM (SELECT occurred_at, subject, detail FROM email_ingest_log WHERE disposition = 'alarm' ORDER BY occurred_at DESC LIMIT 25) a),
    'totals', jsonb_build_object(
      'communications', (SELECT count(*) FROM communications),
      'contacts', (SELECT count(*) FROM contacts),
      'leads', (SELECT count(*) FROM leads),
      'archived_communications', (SELECT count(*) FROM repair_20261013.communications_archived),
      'archived_contacts', (SELECT count(*) FROM repair_20261013.contacts_archived)
    )
  )
$$;

REVOKE ALL ON FUNCTION integrity_scorecard() FROM public;
GRANT EXECUTE ON FUNCTION integrity_scorecard() TO anon, authenticated, service_role;
COMMENT ON FUNCTION integrity_scorecard() IS 'Record-integrity health check. Every count must be zero. Settings → Integrity + nightly SMS.';
