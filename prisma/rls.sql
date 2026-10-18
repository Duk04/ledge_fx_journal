-- ============================================================================
-- Row-Level Security for the FX journal schema
-- ============================================================================
--
-- STATUS QUO: the application currently enforces per-user scoping in the
-- query layer — every Prisma query that touches a user-owned table is
-- written with an explicit `where: { userId }` (or a join back to a row
-- that has one). The app connects to Postgres as the `postgres` superuser
-- (see DATABASE_URL in .env), and Postgres never applies row security to
-- a table's owner or to a superuser, REGARDLESS of whether RLS is enabled
-- on the table (see the "BYPASSRLS" note below). So right now, applying
-- this file changes nothing observable — it is a no-op with the default
-- connection.
--
-- WHEN THIS FILE MATTERS: it is meant to be applied the day this app's
-- database role is changed to a non-owner, least-privilege role (e.g. an
-- `app_user` role used by the deployed API, separate from the `postgres`
-- migration/owner role). From that point on:
--   1. `app_user` must NOT have BYPASSRLS and must NOT own these tables.
--   2. Every request handler must run
--        SELECT set_config('app.current_user_id', $1, true)
--      (or `SET LOCAL app.current_user_id = ...`) at the start of each
--      transaction, with $1 = the authenticated user's UUID.
--   3. From then on, Postgres itself — not just app code — refuses to let
--      a query return or modify another user's rows, even if a future bug
--      forgets a `where userId` clause. RLS here is defense-in-depth, not
--      a replacement for step 2 of setup.
--
-- Run this file manually after `prisma migrate deploy` in the target
-- environment where you've provisioned the restricted role:
--   psql "$DATABASE_URL" -f prisma/rls.sql
-- It is not part of the Prisma migration history because Prisma's
-- migration engine does not manage roles/grants, and because it should
-- only run once a non-owner role actually exists.
-- ============================================================================

-- Instruments is reference data (shared across all users), so it is
-- intentionally left without RLS — everyone may read it, and only the
-- (bypassing) owner role writes to it via the seed script.

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

CREATE POLICY users_self ON users
  USING (id::uuid = current_setting('app.current_user_id', true)::uuid)
  WITH CHECK (id::uuid = current_setting('app.current_user_id', true)::uuid);

-- ---------------------------------------------------------------------------
-- accounts (TradingAccount)
-- ---------------------------------------------------------------------------
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts FORCE ROW LEVEL SECURITY;

CREATE POLICY accounts_owner ON accounts
  USING (user_id::uuid = current_setting('app.current_user_id', true)::uuid)
  WITH CHECK (user_id::uuid = current_setting('app.current_user_id', true)::uuid);

-- ---------------------------------------------------------------------------
-- tags
-- ---------------------------------------------------------------------------
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags FORCE ROW LEVEL SECURITY;

CREATE POLICY tags_owner ON tags
  USING (user_id::uuid = current_setting('app.current_user_id', true)::uuid)
  WITH CHECK (user_id::uuid = current_setting('app.current_user_id', true)::uuid);

-- ---------------------------------------------------------------------------
-- journal_entries
-- ---------------------------------------------------------------------------
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries FORCE ROW LEVEL SECURITY;

CREATE POLICY journal_entries_owner ON journal_entries
  USING (user_id::uuid = current_setting('app.current_user_id', true)::uuid)
  WITH CHECK (user_id::uuid = current_setting('app.current_user_id', true)::uuid);

-- ---------------------------------------------------------------------------
-- checklist_items / daily_checks — the daily checklist. daily_checks has no
-- user_id; it is scoped through its item.
-- ---------------------------------------------------------------------------
ALTER TABLE checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_items FORCE ROW LEVEL SECURITY;

CREATE POLICY checklist_items_owner ON checklist_items
  USING (user_id::uuid = current_setting('app.current_user_id', true)::uuid)
  WITH CHECK (user_id::uuid = current_setting('app.current_user_id', true)::uuid);

ALTER TABLE daily_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_checks FORCE ROW LEVEL SECURITY;

CREATE POLICY daily_checks_via_item ON daily_checks
  USING (
    EXISTS (
      SELECT 1 FROM checklist_items i
      WHERE i.id = daily_checks.item_id
        AND i.user_id::uuid = current_setting('app.current_user_id', true)::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM checklist_items i
      WHERE i.id = daily_checks.item_id
        AND i.user_id::uuid = current_setting('app.current_user_id', true)::uuid
    )
  );

-- ---------------------------------------------------------------------------
-- trades — scoped via a subquery back to the owning account, since Trade
-- has no direct user_id column (it hangs off accounts.user_id instead).
-- ---------------------------------------------------------------------------
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades FORCE ROW LEVEL SECURITY;

CREATE POLICY trades_via_account ON trades
  USING (
    EXISTS (
      SELECT 1 FROM accounts a
      WHERE a.id = trades.account_id
        AND a.user_id::uuid = current_setting('app.current_user_id', true)::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM accounts a
      WHERE a.id = trades.account_id
        AND a.user_id::uuid = current_setting('app.current_user_id', true)::uuid
    )
  );

-- ---------------------------------------------------------------------------
-- balance_events — scoped via the owning account.
-- ---------------------------------------------------------------------------
ALTER TABLE balance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE balance_events FORCE ROW LEVEL SECURITY;

CREATE POLICY balance_events_via_account ON balance_events
  USING (
    EXISTS (
      SELECT 1 FROM accounts a
      WHERE a.id = balance_events.account_id
        AND a.user_id::uuid = current_setting('app.current_user_id', true)::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM accounts a
      WHERE a.id = balance_events.account_id
        AND a.user_id::uuid = current_setting('app.current_user_id', true)::uuid
    )
  );

-- ---------------------------------------------------------------------------
-- trade_tags — scoped via the owning trade -> account chain.
-- ---------------------------------------------------------------------------
ALTER TABLE trade_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_tags FORCE ROW LEVEL SECURITY;

CREATE POLICY trade_tags_via_trade ON trade_tags
  USING (
    EXISTS (
      SELECT 1 FROM trades t
      JOIN accounts a ON a.id = t.account_id
      WHERE t.id = trade_tags.trade_id
        AND a.user_id::uuid = current_setting('app.current_user_id', true)::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM trades t
      JOIN accounts a ON a.id = t.account_id
      WHERE t.id = trade_tags.trade_id
        AND a.user_id::uuid = current_setting('app.current_user_id', true)::uuid
    )
  );

-- ---------------------------------------------------------------------------
-- attachments — scoped via the owning trade -> account chain.
-- ---------------------------------------------------------------------------
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments FORCE ROW LEVEL SECURITY;

CREATE POLICY attachments_via_trade ON attachments
  USING (
    EXISTS (
      SELECT 1 FROM trades t
      JOIN accounts a ON a.id = t.account_id
      WHERE t.id = attachments.trade_id
        AND a.user_id::uuid = current_setting('app.current_user_id', true)::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM trades t
      JOIN accounts a ON a.id = t.account_id
      WHERE t.id = attachments.trade_id
        AND a.user_id::uuid = current_setting('app.current_user_id', true)::uuid
    )
  );

-- ---------------------------------------------------------------------------
-- Auth.js tables (auth_accounts, sessions, verification_tokens) are
-- intentionally left without RLS. They are only ever read/written by the
-- Auth.js server-side adapter (never directly by user-scoped request
-- code), verification_tokens has no user_id at all (identifier is an
-- email/phone, not a user id), and adding policies here would only add
-- risk of locking out sign-in without a matching security benefit.
-- ============================================================================
