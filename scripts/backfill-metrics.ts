/**
 * Recompute every trade's derived columns.
 *
 * The derived columns (netPnl, pips, rMultiple, riskAmount, holdingMinutes,
 * marketSession) are stored, not computed on read — see the note at the top of
 * src/lib/trade-service.ts for why. The price of that decision is exactly this
 * script: whenever a formula, an instrument's pip size, or an account's
 * currency changes, the stored numbers are stale until this runs.
 *
 *   npm run backfill          # recompute everything
 *   npm run backfill -- --dry # report what would change, write nothing
 *
 * It is safe to run repeatedly and reports how many rows actually moved, which
 * is the number you want after changing a formula: if it says 0, the change had
 * no effect on real data and you should be suspicious of your test.
 */
import { Decimal } from "decimal.js";
import { prisma } from "../src/lib/db";
import { derivedColumns, tradeInput } from "../src/lib/trade-service";
import { resolveConversion } from "../src/lib/conversion";

const dry = process.argv.includes("--dry");

function same(a: unknown, b: unknown) {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  try {
    return new Decimal(String(a)).eq(new Decimal(String(b)));
  } catch {
    return String(a) === String(b);
  }
}

async function main() {
  const accounts = await prisma.tradingAccount.findMany({ select: { id: true, label: true, currency: true } });
  let scanned = 0;
  let changed = 0;
  const flagged: string[] = [];

  for (const account of accounts) {
    const trades = await prisma.trade.findMany({
      where: { accountId: account.id },
      include: { instrument: true },
      orderBy: { openedAt: "asc" },
    });

    for (const trade of trades) {
      scanned += 1;
      const conversion = resolveConversion({
        instrument: trade.instrument,
        accountCurrency: account.currency,
        explicitRate: trade.conversionRate?.toString() ?? null,
        referencePrice: (trade.exitPrice ?? trade.entryPrice).toString(),
      });
      if (conversion.needsAttention) {
        flagged.push(
          `${trade.id} ${trade.symbol} — quoted in ${trade.instrument.quoteCurrency}, account in ${account.currency}, no rate available`,
        );
      }

      const next = derivedColumns(tradeInput(trade, trade.instrument, account.currency));
      const moved =
        !same(next.netPnl, trade.netPnl) ||
        !same(next.pips, trade.pips) ||
        !same(next.rMultiple, trade.rMultiple) ||
        !same(next.riskAmount, trade.riskAmount) ||
        !same(next.grossPnl, trade.grossPnl) ||
        next.holdingMinutes !== trade.holdingMinutes ||
        next.marketSession !== trade.marketSession;

      if (!moved) continue;
      changed += 1;
      if (!dry) {
        await prisma.trade.update({ where: { id: trade.id }, data: next });
      }
    }
  }

  console.log(`${dry ? "[dry run] " : ""}${scanned} trades scanned, ${changed} ${dry ? "would change" : "updated"}.`);
  if (flagged.length) {
    console.log(`\n${flagged.length} trade(s) need a conversion rate entered by hand:`);
    for (const line of flagged.slice(0, 20)) console.log(`  ${line}`);
    if (flagged.length > 20) console.log(`  … and ${flagged.length - 20} more`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
