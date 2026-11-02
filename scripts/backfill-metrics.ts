/**
 * Recompute every trade's derived columns.
 *
 * The derived columns (netPnl, pips, rMultiple, riskAmount, holdingMinutes,
 * marketSession) are stored, not computed on read — see the note at the top of
 * src/lib/trade-service.ts for why. The price of that decision is exactly this
 * script: whenever a FORMULA changes, the stored numbers are stale until this
 * runs. (An instrument spec edited in Settings or an account's currency
 * recomputes the affected trades itself — lib/actions/recompute.ts — but a
 * spec changed in the database or in src/lib/instruments.ts by hand does not.)
 *
 *   npm run backfill          # recompute everything
 *   npm run backfill -- --dry # report what would change, write nothing
 *
 * It is safe to run repeatedly and reports how many rows actually moved, which
 * is the number you want after changing a formula: if it says 0, the change had
 * no effect on real data and you should be suspicious of your test.
 */
import { prisma } from "../src/lib/db";
import { derivedColumns, derivedColumnsDiffer, tradeInput } from "../src/lib/trade-service";
import { resolveConversion } from "../src/lib/conversion";

const dry = process.argv.includes("--dry");

async function main() {
  // BACKTEST trades are left as their run wrote them: a run converts its P&L
  // at one rate for the whole run and stores its stats beside them, and a
  // per-trade recompute would make the two disagree (lib/actions/recompute.ts).
  const accounts = await prisma.tradingAccount.findMany({
    where: { accountType: { not: "BACKTEST" } },
    select: { id: true, label: true, currency: true },
  });
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
      // An R-mode trade has no price to convert at: its risk is stated in
      // account currency already.
      const reference = trade.exitPrice ?? trade.entryPrice;
      const conversion = reference
        ? resolveConversion({
            instrument: trade.instrument,
            accountCurrency: account.currency,
            explicitRate: trade.conversionRate?.toString() ?? null,
            referencePrice: reference.toString(),
          })
        : null;
      if (conversion?.needsAttention) {
        flagged.push(
          `${trade.id} ${trade.symbol} — quoted in ${trade.instrument.quoteCurrency}, account in ${account.currency}, no rate available`,
        );
      }

      const next = derivedColumns(tradeInput(trade, trade.instrument, account.currency));
      // Rounded to each column's scale before comparing, or every
      // non-terminating ratio reads as changed (trade-service.ts).
      if (!derivedColumnsDiffer(next, trade)) continue;
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
