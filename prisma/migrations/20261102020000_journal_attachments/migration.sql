-- AlterTable
ALTER TABLE "attachments" ADD COLUMN     "journal_entry_id" TEXT,
ALTER COLUMN "trade_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "attachments_journal_entry_id_idx" ON "attachments"("journal_entry_id");

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- An attachment belongs to a trade OR to a day's journal entry, never both
-- and never neither. Prisma cannot express "exactly one of", so the database
-- holds the line — every ownership check (trade -> account -> user, or
-- journal entry -> user) assumes one path, and a row with none would be
-- reachable by nobody and deletable by nobody.
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_one_owner_check" CHECK (
  num_nonnulls("trade_id", "journal_entry_id") = 1
);
