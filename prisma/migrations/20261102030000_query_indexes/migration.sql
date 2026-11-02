-- CreateIndex
CREATE INDEX "trades_account_id_closed_at_idx" ON "trades"("account_id", "closed_at");

-- CreateIndex
CREATE INDEX "trade_imports_user_id_idx" ON "trade_imports"("user_id");

-- CreateIndex
CREATE INDEX "backtest_runs_strategy_id_idx" ON "backtest_runs"("strategy_id");
