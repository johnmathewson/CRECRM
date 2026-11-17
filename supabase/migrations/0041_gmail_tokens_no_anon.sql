-- 0041 — gmail_oauth_tokens: no anon access.
--
-- The table holds Google refresh tokens (Gmail, Calendar, Drive grants).
-- Its only policy let the anon role — whose key ships to every browser that
-- loads the CRM — read and write every row. All code now reaches it through
-- the service role (tokenStore() in src/lib/gmail-auth.ts, the poll-gmail
-- heartbeat function), which bypasses RLS, so the policy goes and nothing
-- else replaces it.
--
-- Apply only AFTER the code that uses tokenStore() is deployed; before that,
-- dropping the policy would stop Gmail polling, acks and sends.

DROP POLICY IF EXISTS gmail_oauth_tokens_anon_all ON gmail_oauth_tokens;
