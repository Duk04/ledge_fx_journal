-- Data repair, no schema change.
--
-- An OPEN or CANCELLED price trade has no exit. The edit form used to post a
-- hidden exit price and close time when a CLOSED trade was switched back to
-- OPEN, and the action stored them with the P&L computed from them — so the
-- equity curve and today's P&L (which filter on closed_at / net_pnl) counted
-- a trade the summary called open. parseTradeForm() now drops them
-- (src/lib/schemas/trade.ts); this clears the rows written before that.
--
-- It clears exactly what computeTrade() leaves null without an exit: pips,
-- gross and net P&L and R come from exit_price, holding time from closed_at.
-- risk_amount and market_session depend only on the entry and stay.
-- A partly closed trade is untouched: its aggregate exit_price and closed_at
-- are already null (lib/metrics/fills.ts).
UPDATE "trades"
SET "exit_price" = NULL,
    "closed_at" = NULL,
    "pips" = NULL,
    "gross_pnl" = NULL,
    "net_pnl" = NULL,
    "r_multiple" = NULL,
    "holding_minutes" = NULL
WHERE "entry_mode" = 'PRICE'
  AND "status" <> 'CLOSED'
  AND ("exit_price" IS NOT NULL OR "closed_at" IS NOT NULL);
