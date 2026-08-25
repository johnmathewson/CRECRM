-- 0034 — Drop anon access to the three credential tables.
--
-- ⚠️  DO NOT APPLY UNTIL BOTH ARE TRUE:
--   1. SUPABASE_SERVICE_ROLE_KEY is set on the `stewardship-crm` Netlify site
--   2. The branch `security/phase1-service-role-and-staff-gates` is deployed to prod
--
-- Applying early takes the CRM offline: until the new code is live, every route
-- still authenticates to Postgres as `anon` and depends on these policies.
--
-- CONTEXT: the `*_anon_all` policies gate on
--   organization_id = 'a0000000-0000-0000-0000-000000000001'
-- which is a hardcoded constant, not auth.uid(). Single-tenant means that
-- predicate is effectively `true` for the anon role, so these policies grant
-- full SELECT/INSERT/UPDATE/DELETE to anyone holding the public anon key.
--
-- After this migration these three tables are reachable only via the
-- service-role key (server-side), matching how sag.* was locked down 07-01.

BEGIN;

DROP POLICY IF EXISTS gmail_oauth_tokens_anon_all ON public.gmail_oauth_tokens;
DROP POLICY IF EXISTS extension_keys_anon_all     ON public.extension_api_keys;
DROP POLICY IF EXISTS owner_tokens_anon_all       ON public.owner_access_tokens;

REVOKE ALL ON public.gmail_oauth_tokens  FROM anon, authenticated;
REVOKE ALL ON public.extension_api_keys  FROM anon, authenticated;
REVOKE ALL ON public.owner_access_tokens FROM anon, authenticated;

-- RLS stays enabled with zero policies = deny-all for every role except
-- service_role, which bypasses RLS by design.
ALTER TABLE public.gmail_oauth_tokens  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.extension_api_keys  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_access_tokens ENABLE ROW LEVEL SECURITY;

COMMIT;

-- ROLLBACK (if the app breaks and you need access restored fast):
--
--   GRANT ALL ON public.owner_access_tokens TO anon;
--   CREATE POLICY owner_tokens_anon_all ON public.owner_access_tokens
--     FOR ALL TO anon
--     USING      (organization_id = 'a0000000-0000-0000-0000-000000000001'::uuid)
--     WITH CHECK (organization_id = 'a0000000-0000-0000-0000-000000000001'::uuid);
--   -- (repeat per table; policy names above)
