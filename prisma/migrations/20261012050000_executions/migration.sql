-- Executions (fills). See the Execution model in schema.prisma and
-- src/lib/metrics/fills.ts. After this migration every OPEN or CLOSED trade
-- has at least one ENTRY execution; CANCELLED trades never filled and get
-- none.

-- CreateEnum
CREATE TYPE "ExecutionKind" AS ENUM ('ENTRY', 'EXIT');

-- AlterTable
ALTER TABLE "trades" ADD COLUMN     "initial_stop_loss" DECIMAL(18,8);

-- CreateTable
CREATE TABLE "executions" (
    "id" TEXT NOT NULL,
    "trade_id" TEXT NOT NULL,
    "kind" "ExecutionKind" NOT NULL,
    "executed_at" TIMESTAMP(3) NOT NULL,
    "price" DECIMAL(18,8) NOT NULL,
    "volume_lots" DECIMAL(12,4) NOT NULL,
    "external_deal_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "executions_trade_id_executed_at_idx" ON "executions"("trade_id", "executed_at");

-- CreateIndex
CREATE UNIQUE INDEX "executions_trade_id_external_deal_id_key" ON "executions"("trade_id", "external_deal_id");

-- AddForeignKey
ALTER TABLE "executions" ADD CONSTRAINT "executions_trade_id_fkey" FOREIGN KEY ("trade_id") REFERENCES "trades"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: the single entry (and exit) every existing trade stands for.
-- The trade-level columns are then exactly the aggregate of these fills, so
-- `npm run backfill -- --dry` reports no change (verified when written).
INSERT INTO "executions" ("id", "trade_id", "kind", "executed_at", "price", "volume_lots")
SELECT gen_random_uuid()::text, t."id", 'ENTRY', t."opened_at", t."entry_price", t."volume_lots"
FROM "trades" t
WHERE t."status" <> 'CANCELLED';

INSERT INTO "executions" ("id", "trade_id", "kind", "executed_at", "price", "volume_lots")
SELECT gen_random_uuid()::text, t."id", 'EXIT', t."closed_at", t."exit_price", t."volume_lots"
FROM "trades" t
WHERE t."status" = 'CLOSED' AND t."exit_price" IS NOT NULL AND t."closed_at" IS NOT NULL;

-- Until now the only stop on record is the current one; treat it as the
-- initial stop so no existing R multiple changes.
UPDATE "trades" SET "initial_stop_loss" = "stop_loss" WHERE "stop_loss" IS NOT NULL;
