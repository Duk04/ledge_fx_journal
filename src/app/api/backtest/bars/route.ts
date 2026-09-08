import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getBars, lastCloseIn } from "@/lib/queries/candles";
import { resolveRunConversionRate, toSimInstrument } from "@/lib/backtest/run-setup";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

/**
 * Historical bars for a browser-side strategy run.
 *
 * This endpoint exists because strategy code no longer executes on the
 * server — it runs in a Web Worker in the author's own browser (see
 * src/lib/backtest/worker.ts for why). The worker needs the bars, so they
 * have to cross the wire.
 *
 * Bars are shared reference data, not anyone's private information (see the
 * note at the top of src/lib/queries/candles.ts), so there is no tenancy
 * question here — only an authentication one and a cost one. Both are
 * answered below.
 */

/**
 * Ceiling on bars per request.
 *
 * The engine's own HARD_BAR_CAP is 1,000,000 and a run was capped at 500,000,
 * but those were limits on in-process computation. Shipping bars over HTTP is
 * a different cost: at roughly 80 bytes of JSON per bar, 500k bars is a ~40MB
 * response, which is a trivial bandwidth amplifier for an authenticated
 * caller in a loop. 200k bars is about two years of H1 or five months of M5 —
 * more than a strategy run needs, and a bounded response.
 */
export const MAX_BARS_PER_REQUEST = 200_000;

/** Below this there is not enough history for a run to mean anything. */
export const MIN_BARS_PER_REQUEST = 50;

const TIMEFRAMES = ["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1"] as const;

const querySchema = z.object({
  symbol: z.string().trim().min(1).max(20).toUpperCase(),
  timeframe: z.enum(TIMEFRAMES),
  from: z.coerce.date(),
  to: z.coerce.date(),
});

export async function GET(request: NextRequest) {
  // Not `requireUser()`: that redirects, which turns an unauthenticated fetch
  // into a 307 pointing at an HTML login page. A fetch caller wants a status
  // code it can branch on.
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Bad request", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
      { status: 400 },
    );
  }

  const { symbol, timeframe, from, to } = parsed.data;
  if (to <= from) {
    return NextResponse.json({ error: "`to` must be after `from`." }, { status: 400 });
  }

  // One over the cap, so a range that exceeds it is detectable rather than
  // silently truncated — a quietly shortened bar array is a wrong backtest,
  // not a slow one.
  const { bars, timeframe: served, aggregatedFrom } = await getBars({
    symbol,
    timeframe,
    from,
    to,
    limit: MAX_BARS_PER_REQUEST + 1,
  });

  if (bars.length > MAX_BARS_PER_REQUEST) {
    return NextResponse.json(
      {
        error: `That range holds more than ${MAX_BARS_PER_REQUEST.toLocaleString()} ${timeframe} bars. Narrow the dates or use a coarser timeframe.`,
      },
      { status: 413 },
    );
  }

  if (bars.length < MIN_BARS_PER_REQUEST) {
    return NextResponse.json(
      {
        error: `Only ${bars.length} bar(s) of ${symbol} ${timeframe} are stored in that range — a run needs at least ${MIN_BARS_PER_REQUEST}. Import more data or widen the range.`,
      },
      { status: 422 },
    );
  }

  // The instrument spec and the conversion rate travel with the bars because
  // the browser's simulation needs both to build a BacktestConfig, and both
  // are server-derived on purpose: pipSize and contractSize come from the
  // shared Instrument table, and the conversion rate scales every P&L figure
  // the run produces. `recordStrategyRun` re-derives the rate when it writes
  // the run, so what is stored is never the client's copy.
  const instrument = await prisma.instrument.findUnique({ where: { symbol } });
  if (!instrument) {
    return NextResponse.json({ error: `"${symbol}" is not a known instrument.` }, { status: 404 });
  }

  const lastClose = await lastCloseIn({ symbol, timeframe, from, to });
  const conversionRate =
    lastClose === null ? 1 : resolveRunConversionRate(instrument, lastClose);

  return NextResponse.json(
    {
      bars,
      timeframe: served,
      aggregatedFrom,
      instrument: toSimInstrument(instrument),
      conversionRate,
    },
    {
      headers: {
        // A closed historical range is effectively immutable, but only until
        // someone re-imports bars over it — which is why this is `private`
        // and short rather than `immutable`. `revalidateDataPage()` in
        // actions/candles.ts is the server-side invalidation hook; this
        // header only spares the browser a refetch inside one session.
        "Cache-Control": "private, max-age=300",
      },
    },
  );
}
