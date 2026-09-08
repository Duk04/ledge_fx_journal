-- CreateEnum
CREATE TYPE "Timeframe" AS ENUM ('M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1');

-- CreateEnum
CREATE TYPE "CandleSource" AS ENUM ('MT5_CSV', 'GENERIC_CSV', 'API');

-- CreateEnum
CREATE TYPE "BacktestKind" AS ENUM ('REPLAY', 'STRATEGY');

-- CreateEnum
CREATE TYPE "BacktestStatus" AS ENUM ('DRAFT', 'RUNNING', 'DONE', 'FAILED');

-- AlterEnum
ALTER TYPE "AccountType" ADD VALUE 'BACKTEST';

-- AlterTable
ALTER TABLE "trades" ADD COLUMN "backtest_run_id" TEXT;

-- CreateTable
CREATE TABLE "candles" (
    "symbol" TEXT NOT NULL,
    "timeframe" "Timeframe" NOT NULL,
    "ts" TIMESTAMPTZ(3) NOT NULL,
    "open" DECIMAL(18,8) NOT NULL,
    "high" DECIMAL(18,8) NOT NULL,
    "low" DECIMAL(18,8) NOT NULL,
    "close" DECIMAL(18,8) NOT NULL,
    "volume" DECIMAL(18,4),
    "spread" INTEGER,
    "source" "CandleSource" NOT NULL,

    CONSTRAINT "candles_pkey" PRIMARY KEY ("symbol","timeframe","ts")
);

-- CreateTable
CREATE TABLE "candle_imports" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "timeframe" "Timeframe" NOT NULL,
    "source" "CandleSource" NOT NULL,
    "file_name" TEXT,
    "row_count" INTEGER NOT NULL,
    "from_ts" TIMESTAMPTZ(3) NOT NULL,
    "to_ts" TIMESTAMPTZ(3) NOT NULL,
    "tz_offset_minutes" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candle_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategies" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "code" TEXT NOT NULL,
    "params" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "strategies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backtest_runs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "strategy_id" TEXT,
    "kind" "BacktestKind" NOT NULL,
    "status" "BacktestStatus" NOT NULL DEFAULT 'DRAFT',
    "label" TEXT,
    "symbol" TEXT NOT NULL,
    "timeframe" "Timeframe" NOT NULL,
    "from_ts" TIMESTAMPTZ(3) NOT NULL,
    "to_ts" TIMESTAMPTZ(3) NOT NULL,
    "initial_balance" DECIMAL(18,2) NOT NULL,
    "spread_points" INTEGER NOT NULL DEFAULT 0,
    "commission_per_lot" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "slippage_points" INTEGER NOT NULL DEFAULT 0,
    "pessimistic_fills" BOOLEAN NOT NULL DEFAULT true,
    "params" JSONB,
    "stats" JSONB,
    "error" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backtest_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "candles_symbol_timeframe_ts_idx" ON "candles"("symbol", "timeframe", "ts" DESC);

-- CreateIndex
CREATE INDEX "candle_imports_user_id_symbol_timeframe_idx" ON "candle_imports"("user_id", "symbol", "timeframe");

-- CreateIndex
CREATE UNIQUE INDEX "strategies_user_id_name_key" ON "strategies"("user_id", "name");

-- CreateIndex
CREATE INDEX "backtest_runs_user_id_created_at_idx" ON "backtest_runs"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "backtest_runs_account_id_idx" ON "backtest_runs"("account_id");

-- CreateIndex
CREATE INDEX "trades_backtest_run_id_idx" ON "trades"("backtest_run_id");

-- AddForeignKey
ALTER TABLE "candles" ADD CONSTRAINT "candles_symbol_fkey" FOREIGN KEY ("symbol") REFERENCES "instruments"("symbol") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candle_imports" ADD CONSTRAINT "candle_imports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backtest_runs" ADD CONSTRAINT "backtest_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backtest_runs" ADD CONSTRAINT "backtest_runs_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backtest_runs" ADD CONSTRAINT "backtest_runs_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trades" ADD CONSTRAINT "trades_backtest_run_id_fkey" FOREIGN KEY ("backtest_run_id") REFERENCES "backtest_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
