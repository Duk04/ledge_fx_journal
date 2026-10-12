-- Playbooks: named setups with rules, a link from each trade, and a per-trade
-- checklist of which rules were followed (docs/PLAYBOOKS.md).

-- AlterTable
ALTER TABLE "trades" ADD COLUMN     "playbook_id" TEXT;

-- CreateTable
CREATE TABLE "playbooks" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "playbooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playbook_rules" (
    "id" TEXT NOT NULL,
    "playbook_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "playbook_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_rule_checks" (
    "trade_id" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "followed" BOOLEAN NOT NULL,

    CONSTRAINT "trade_rule_checks_pkey" PRIMARY KEY ("trade_id","rule_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "playbooks_user_id_name_key" ON "playbooks"("user_id", "name");

-- CreateIndex
CREATE INDEX "playbook_rules_playbook_id_sort_order_idx" ON "playbook_rules"("playbook_id", "sort_order");

-- CreateIndex
CREATE INDEX "trade_rule_checks_rule_id_idx" ON "trade_rule_checks"("rule_id");

-- CreateIndex
CREATE INDEX "trades_playbook_id_idx" ON "trades"("playbook_id");

-- AddForeignKey
ALTER TABLE "trades" ADD CONSTRAINT "trades_playbook_id_fkey" FOREIGN KEY ("playbook_id") REFERENCES "playbooks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playbooks" ADD CONSTRAINT "playbooks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playbook_rules" ADD CONSTRAINT "playbook_rules_playbook_id_fkey" FOREIGN KEY ("playbook_id") REFERENCES "playbooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_rule_checks" ADD CONSTRAINT "trade_rule_checks_trade_id_fkey" FOREIGN KEY ("trade_id") REFERENCES "trades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_rule_checks" ADD CONSTRAINT "trade_rule_checks_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "playbook_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

