-- Broker statement import (docs/IMPORT.md): per-user symbol aliases, an audit
-- row per import, and the columns that link trades and cash moves to it.

-- CreateEnum
CREATE TYPE "StatementSource" AS ENUM ('MT4_HTML', 'MT5_HTML', 'CSV');

-- AlterTable
ALTER TABLE "trades" ADD COLUMN     "broker_profit" DECIMAL(18,2),
ADD COLUMN     "import_id" TEXT;

-- AlterTable
ALTER TABLE "balance_events" ADD COLUMN     "external_ticket" TEXT,
ADD COLUMN     "import_id" TEXT;

-- CreateTable
CREATE TABLE "symbol_aliases" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "broker_symbol" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,

    CONSTRAINT "symbol_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_imports" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "source" "StatementSource" NOT NULL,
    "file_name" TEXT,
    "tz_mode" TEXT NOT NULL,
    "tz_offset_minutes" INTEGER,
    "trades_created" INTEGER NOT NULL,
    "trades_skipped" INTEGER NOT NULL,
    "balance_events" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trade_imports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "symbol_aliases_user_id_broker_symbol_key" ON "symbol_aliases"("user_id", "broker_symbol");

-- CreateIndex
CREATE INDEX "trade_imports_account_id_created_at_idx" ON "trade_imports"("account_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "trades_import_id_idx" ON "trades"("import_id");

-- CreateIndex
CREATE UNIQUE INDEX "balance_events_account_id_external_ticket_key" ON "balance_events"("account_id", "external_ticket");

-- AddForeignKey
ALTER TABLE "trades" ADD CONSTRAINT "trades_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "trade_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_events" ADD CONSTRAINT "balance_events_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "trade_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "symbol_aliases" ADD CONSTRAINT "symbol_aliases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "symbol_aliases" ADD CONSTRAINT "symbol_aliases_symbol_fkey" FOREIGN KEY ("symbol") REFERENCES "instruments"("symbol") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_imports" ADD CONSTRAINT "trade_imports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_imports" ADD CONSTRAINT "trade_imports_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

