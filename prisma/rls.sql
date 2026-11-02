-- ============================================================================
-- Row-Level Security for the FX journal schema
-- ============================================================================
--
-- STATUS QUO: the application enforces per-user scoping in the query layer —
-- every Prisma query that touches a user-owned table is written with an
-- explicit `where: { userId }` (or a join back to a row that has one; see
-- the SCOPING RULE in src/lib/session.ts). The app connects to Postgres as
-- the role that owns the tables, and Postgres never applies row security to
-- a table's owner (without FORCE) or to a superuser / BYPASSRLS role. So
-- with the default connection, applying this file changes nothing
-- observable.
--
-- WHEN THIS FILE MATTERS: the day request-serving code connects as a
-- non-owner, least-privilege role (say `app_user`), separate from the
-- migration/owner role. From then on:
--   1. `app_user` must NOT have BYPASSRLS and must NOT own these tables.
--   2. Every request runs, at the start of each transaction,
--        SELECT set_config('app.current_user_id', $1, true)
--      with $1 = the authenticated user's id. `true` makes it transaction-
--      local, which is what a pooled connection needs — and after such a
--      transaction ends, a pooled connection reports the setting as '' (not
--      NULL), which is why every policy reads it through
--      app_current_user_id() below instead of casting it directly.
--   3. Postgres itself — not only app code — then refuses to return or
--      modify another user's rows, even if a future bug forgets a
--      `where userId` clause. Defence in depth, not a replacement for 2.
--
-- WHAT CANNOT RUN AS `app_user`: anything that legitimately reads across
-- users or before there is a user. Under these policies those paths see no
-- rows at all, so they need a separate connection as a BYPASSRLS role:
--   - Auth.js (the Prisma adapter, the credentials `authorize`, the
--     `signIn` callback): looks users up by email before a session exists.
--   - registration, password reset, and the auth throttle (`auth_attempts`).
--   - the notification cron (src/app/api/cron/notifications) and the
--     signed unsubscribe link: every user's preferences and trades.
--   - `npm run backfill`, the seed, and `prisma migrate`.
-- Splitting those onto their own client is the work this file waits on.
--
-- Run it by hand after `prisma migrate deploy`, in an environment where the
-- restricted role exists:
--   psql "$DATABASE_URL" -f prisma/rls.sql
-- It is not part of the Prisma migration history: Prisma's migration engine
-- does not manage roles or grants, and the file should only run once a
-- non-owner role exists. It is re-runnable (policies are dropped first).
-- ============================================================================

-- The current request's user id, or NULL when none is set. NULLIF turns the
-- '' a pooled connection reports after a SET LOCAL into NULL — compared to a
-- column, NULL matches nothing, so an unset id fails closed instead of
-- raising "invalid input syntax" the way ''::uuid did. Ids are TEXT columns
-- (Prisma's String @default(uuid())), so they are compared as text.
CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.current_user_id', true), '') $$;

-- Shared reference data — `instruments` and `candles` — is intentionally left
-- without RLS: every user reads it, and every write is gated in the app by
-- requireOwner() (AGENTS.md, "The scoping rule").

-- ---------------------------------------------------------------------------
-- Tables with their own user_id. One policy shape for all of them.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'accounts',
    'tags',
    'journal_entries',
    'checklist_items',
    'playbooks',
    'symbol_aliases',
    'trade_imports',
    'candle_imports',
    'strategies',
    'backtest_runs',
    'notification_prefs',
    'notification_logs',
    'revoked_sessions'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_owner', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id())',
      t || '_owner',
      t
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- users — a user sees only their own row. (See the header: Auth.js's
-- by-email lookups cannot run under this policy.)
-- ---------------------------------------------------------------------------
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_self ON users;
CREATE POLICY users_self ON users
  USING (id = app_current_user_id())
  WITH CHECK (id = app_current_user_id());

-- ---------------------------------------------------------------------------
-- Through an account: trades, balance events.
-- ---------------------------------------------------------------------------
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trades_via_account ON trades;
CREATE POLICY trades_via_account ON trades
  USING (EXISTS (SELECT 1 FROM accounts a WHERE a.id = trades.account_id AND a.user_id = app_current_user_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM accounts a WHERE a.id = trades.account_id AND a.user_id = app_current_user_id()));

ALTER TABLE balance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE balance_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS balance_events_via_account ON balance_events;
CREATE POLICY balance_events_via_account ON balance_events
  USING (EXISTS (SELECT 1 FROM accounts a WHERE a.id = balance_events.account_id AND a.user_id = app_current_user_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM accounts a WHERE a.id = balance_events.account_id AND a.user_id = app_current_user_id()));

-- ---------------------------------------------------------------------------
-- Through a trade: tags on it, its fills, its playbook checklist answers.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['trade_tags', 'executions', 'trade_rule_checks'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_via_trade', t);
    EXECUTE format(
      'CREATE POLICY %1$I ON %2$I '
      'USING (EXISTS (SELECT 1 FROM trades tr JOIN accounts a ON a.id = tr.account_id '
      '  WHERE tr.id = %2$I.trade_id AND a.user_id = app_current_user_id())) '
      'WITH CHECK (EXISTS (SELECT 1 FROM trades tr JOIN accounts a ON a.id = tr.account_id '
      '  WHERE tr.id = %2$I.trade_id AND a.user_id = app_current_user_id()))',
      t || '_via_trade',
      t
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- attachments — on a trade OR on a journal entry (exactly one; a CHECK in
-- migration journal_attachments), so ownership runs through whichever it has.
-- ---------------------------------------------------------------------------
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attachments_via_trade ON attachments;
DROP POLICY IF EXISTS attachments_via_owner ON attachments;
CREATE POLICY attachments_via_owner ON attachments
  USING (
    EXISTS (
      SELECT 1 FROM trades tr JOIN accounts a ON a.id = tr.account_id
      WHERE tr.id = attachments.trade_id AND a.user_id = app_current_user_id()
    )
    OR EXISTS (
      SELECT 1 FROM journal_entries j
      WHERE j.id = attachments.journal_entry_id AND j.user_id = app_current_user_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM trades tr JOIN accounts a ON a.id = tr.account_id
      WHERE tr.id = attachments.trade_id AND a.user_id = app_current_user_id()
    )
    OR EXISTS (
      SELECT 1 FROM journal_entries j
      WHERE j.id = attachments.journal_entry_id AND j.user_id = app_current_user_id()
    )
  );

-- ---------------------------------------------------------------------------
-- Through a parent row with a user_id: a playbook's rules, a checklist
-- item's daily ticks.
-- ---------------------------------------------------------------------------
ALTER TABLE playbook_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE playbook_rules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS playbook_rules_via_playbook ON playbook_rules;
CREATE POLICY playbook_rules_via_playbook ON playbook_rules
  USING (EXISTS (SELECT 1 FROM playbooks p WHERE p.id = playbook_rules.playbook_id AND p.user_id = app_current_user_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM playbooks p WHERE p.id = playbook_rules.playbook_id AND p.user_id = app_current_user_id()));

ALTER TABLE daily_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_checks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS daily_checks_via_item ON daily_checks;
CREATE POLICY daily_checks_via_item ON daily_checks
  USING (EXISTS (SELECT 1 FROM checklist_items i WHERE i.id = daily_checks.item_id AND i.user_id = app_current_user_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM checklist_items i WHERE i.id = daily_checks.item_id AND i.user_id = app_current_user_id()));

-- ---------------------------------------------------------------------------
-- Left without RLS, on purpose:
--   - auth_accounts, verification_tokens: only the Auth.js adapter touches
--     them, before or during sign-in; verification_tokens has no user id at
--     all (its identifier is an email).
--   - auth_attempts: the sign-in throttle's audit log, written before there
--     is a user (user_id is often NULL).
-- (The Auth.js `sessions` table this file once mentioned was dropped —
-- sessions are JWTs; revocation is `revoked_sessions`, covered above.)
-- ============================================================================
