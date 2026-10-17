-- CreateEnum
CREATE TYPE "TradeEntryMode" AS ENUM ('PRICE', 'R_MULTIPLE');

-- AlterTable
ALTER TABLE "trades" ADD COLUMN     "entry_mode" "TradeEntryMode" NOT NULL DEFAULT 'PRICE',
ADD COLUMN     "planned_risk" DECIMAL(18,2),
ADD COLUMN     "planned_rr" DECIMAL(10,4),
ADD COLUMN     "result_r" DECIMAL(10,4),
ALTER COLUMN "entry_price" DROP NOT NULL,
ALTER COLUMN "volume_lots" DROP NOT NULL;

-- The nullability above is per mode, not optional in general: a PRICE trade
-- still needs its entry price and size (every price formula reads them), and
-- an R_MULTIPLE trade needs the money at risk that turns R into P&L. Prisma
-- cannot express a conditional NOT NULL, so the database holds the line.
ALTER TABLE "trades" ADD CONSTRAINT "trades_entry_mode_fields_check" CHECK (
  ("entry_mode" = 'PRICE' AND "entry_price" IS NOT NULL AND "volume_lots" IS NOT NULL)
  OR ("entry_mode" = 'R_MULTIPLE' AND "planned_risk" IS NOT NULL)
);
