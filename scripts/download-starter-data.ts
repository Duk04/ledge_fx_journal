/**
 * `npm run data:starter` — fills this instance's candle table with a starter
 * set from OANDA, so the backtest and the trade charts have something to
 * show before anyone imports a file. docs/BACKTEST-DATA.md.
 *
 * Insert-only, like the in-app download: run it again any time to top the
 * set up to yesterday; bars already stored (including MT5 imports) are left
 * alone. Needs OANDA_API_TOKEN in .env.
 *
 * Runs with `--conditions=react-server` so the server-only modules it shares
 * with the app (the candle writer) load outside Next.
 */
import { prisma } from "../src/lib/db";
import { insertMissingCandles } from "../src/lib/candles/upsert";
import { defaultDownloadRange, fetchOandaCandles, type OandaEnvironment } from "../src/lib/candles/oanda";
import type { Timeframe } from "@prisma/client";

const SYMBOLS = ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD"];
/** What practice mostly uses: M15 for replays, H1 and D1 for context. */
const TIMEFRAMES: Timeframe[] = ["M15", "H1", "D1"];

async function main() {
  try {
    process.loadEnvFile();
  } catch {
    // No .env: the environment already holds the variables.
  }
  const token = process.env.OANDA_API_TOKEN?.trim();
  if (!token) {
    console.error('OANDA_API_TOKEN is not set. See docs/BACKTEST-DATA.md "Downloading from OANDA".');
    process.exit(1);
  }
  const environment = (process.env.OANDA_ENVIRONMENT === "live" ? "live" : "practice") as OandaEnvironment;
  const owner = await prisma.user.findFirst({ where: { role: "OWNER" }, orderBy: { createdAt: "asc" } });

  for (const symbol of SYMBOLS) {
    const instrument = await prisma.instrument.findUnique({ where: { symbol }, select: { digits: true } });
    if (!instrument) {
      console.warn(`${symbol}: not in the instrument table, skipped (run npm run db:seed first).`);
      continue;
    }
    for (const timeframe of TIMEFRAMES) {
      const range = defaultDownloadRange(timeframe);
      const from = new Date(`${range.from}T00:00:00Z`);
      const to = new Date(new Date(`${range.to}T00:00:00Z`).getTime() + 86_400_000);
      try {
        const bars = await fetchOandaCandles({
          symbol,
          timeframe,
          from,
          to,
          pointSize: 10 ** -instrument.digits,
          token,
          environment,
        });
        const { inserted, existing } = await insertMissingCandles(symbol, timeframe, "API", bars);
        if (owner && bars.length) {
          await prisma.candleImport.create({
            data: {
              userId: owner.id,
              symbol,
              timeframe,
              source: "API",
              fileName: "OANDA (starter)",
              rowCount: bars.length,
              fromTs: new Date(bars[0].ts),
              toTs: new Date(bars[bars.length - 1].ts),
            },
          });
        }
        console.log(
          `${symbol} ${timeframe}: ${inserted} new, ${existing} already stored (${range.from} → ${range.to})`,
        );
      } catch (err) {
        console.error(`${symbol} ${timeframe}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
