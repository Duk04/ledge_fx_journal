-- Prop-firm challenge rules on trading accounts (src/lib/prop.ts) and
-- MAE/MFE prices on trades (src/lib/metrics/excursion.ts). All nullable:
-- nothing existing changes.

-- CreateEnum
CREATE TYPE "DrawdownMode" AS ENUM ('STATIC', 'TRAILING');

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "daily_loss_limit_pct" DECIMAL(6,3),
ADD COLUMN     "drawdown_mode" "DrawdownMode" NOT NULL DEFAULT 'STATIC',
ADD COLUMN     "max_drawdown_pct" DECIMAL(6,3),
ADD COLUMN     "min_trading_days" INTEGER,
ADD COLUMN     "profit_target_pct" DECIMAL(6,3);

-- AlterTable
ALTER TABLE "trades" ADD COLUMN     "mae_price" DECIMAL(18,8),
ADD COLUMN     "mfe_price" DECIMAL(18,8);

