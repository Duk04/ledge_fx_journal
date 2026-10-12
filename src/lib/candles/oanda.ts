import type { Timeframe } from "@prisma/client";
import type { ParsedBar } from "./parse";

/**
 * Historical candles from OANDA's v20 REST API — the "no import needed"
 * source (docs/BACKTEST-DATA.md "Downloading from OANDA").
 *
 * WHY OANDA. Dukascopy's open datafeed, what most free tools used, now
 * answers 429 and points at a requester-pays S3 bucket. OANDA gives any free
 * practice account an API token with years of M1–D1 history for FX, metals
 * and index CFDs, from a real broker. It needs one token, set once as
 * OANDA_API_TOKEN.
 *
 * WHAT IS STORED.
 *  - BID prices, which is what an MT5 chart shows and what the rest of the
 *    data pipeline assumes.
 *  - The spread at the close, (ask − bid) in points, into `spread`, so the
 *    fill model uses the real spread of each bar the way it does for MT5
 *    exports.
 *  - Complete candles only: a still-forming bar would be stored and never
 *    corrected, because downloads only fill gaps.
 *
 * ALIGNMENT. H4, D1 and W1 are requested on a UTC grid (dailyAlignment=0,
 * alignmentTimezone=UTC, weeks from Monday), the same buckets
 * lib/candles/aggregate.ts builds. OANDA's default is a 17:00 New York day,
 * which would put every daily bar five hours off the rest of the app.
 *
 * Pure apart from `fetch` (which the caller may inject): no env, no
 * database, no `server-only`, so the starter-data script can use it too.
 */

/** Our symbols → OANDA instrument names. A symbol missing here cannot be
 * downloaded; the UI says so instead of guessing a name. */
export const OANDA_INSTRUMENTS: Record<string, string> = {
  EURUSD: "EUR_USD",
  GBPUSD: "GBP_USD",
  USDJPY: "USD_JPY",
  USDCHF: "USD_CHF",
  USDCAD: "USD_CAD",
  AUDUSD: "AUD_USD",
  NZDUSD: "NZD_USD",
  EURGBP: "EUR_GBP",
  EURJPY: "EUR_JPY",
  GBPJPY: "GBP_JPY",
  EURAUD: "EUR_AUD",
  AUDJPY: "AUD_JPY",
  CADJPY: "CAD_JPY",
  CHFJPY: "CHF_JPY",
  EURCHF: "EUR_CHF",
  GBPAUD: "GBP_AUD",
  XAUUSD: "XAU_USD",
  XAGUSD: "XAG_USD",
  US30: "US30_USD",
  NAS100: "NAS100_USD",
  SPX500: "SPX500_USD",
  GER40: "DE30_EUR",
  UK100: "UK100_GBP",
  JP225: "JP225_USD",
  USOIL: "WTICO_USD",
  UKOIL: "BCO_USD",
  BTCUSD: "BTC_USD",
  ETHUSD: "ETH_USD",
};

const GRANULARITY: Partial<Record<Timeframe, string>> = {
  M1: "M1",
  M5: "M5",
  M15: "M15",
  M30: "M30",
  H1: "H1",
  H4: "H4",
  D1: "D",
  W1: "W",
};

export const BAR_MS: Record<Timeframe, number> = {
  M1: 60_000,
  M5: 5 * 60_000,
  M15: 15 * 60_000,
  M30: 30 * 60_000,
  H1: 3_600_000,
  H4: 4 * 3_600_000,
  D1: 86_400_000,
  W1: 7 * 86_400_000,
};

/** One download's ceiling: about seven years of H1, two of M15, or six
 * weeks of M1. Bounds the requests to OANDA (12 pages at most) and how long
 * the download action holds a server function open. */
export const MAX_DOWNLOAD_BARS = 60_000;

/** OANDA's per-request ceiling. */
const MAX_COUNT = 5000;

export type OandaEnvironment = "practice" | "live";

const HOSTS: Record<OandaEnvironment, string> = {
  practice: "https://api-fxpractice.oanda.com",
  live: "https://api-fxtrade.oanda.com",
};

interface OandaCandle {
  complete: boolean;
  volume?: number;
  time: string;
  bid?: { o: string; h: string; l: string; c: string };
  ask?: { o: string; h: string; l: string; c: string };
}

/** One page of the API's JSON → bars. Exported for the tests. */
export function parseOandaCandles(json: unknown, pointSize: number): ParsedBar[] {
  const candles = (json as { candles?: OandaCandle[] } | null)?.candles ?? [];
  const out: ParsedBar[] = [];
  for (const c of candles) {
    if (!c.complete || !c.bid) continue;
    // Requested with Accept-Datetime-Format: UNIX — "1709510400.000000000".
    const ts = Math.round(Number.parseFloat(c.time) * 1000);
    if (!Number.isFinite(ts)) continue;
    const spread = c.ask ? Math.max(0, Math.round((Number(c.ask.c) - Number(c.bid.c)) / pointSize)) : undefined;
    out.push({
      ts,
      open: Number(c.bid.o),
      high: Number(c.bid.h),
      low: Number(c.bid.l),
      close: Number(c.bid.c),
      volume: c.volume,
      spread,
    });
  }
  return out;
}

export class OandaError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

/**
 * Every complete bar in [from, to), paging 5000 at a time from `from`.
 * Throws OandaError on an HTTP failure; the message carries OANDA's own
 * `errorMessage` (an invalid token, an instrument the account cannot
 * trade, a range before the instrument's history).
 */
export async function fetchOandaCandles(input: {
  symbol: string;
  timeframe: Timeframe;
  from: Date;
  to: Date;
  pointSize: number;
  token: string;
  environment?: OandaEnvironment;
  fetchImpl?: typeof fetch;
}): Promise<ParsedBar[]> {
  const instrument = OANDA_INSTRUMENTS[input.symbol];
  const granularity = GRANULARITY[input.timeframe];
  if (!instrument) throw new OandaError(`${input.symbol} has no OANDA instrument mapping.`, null);
  if (!granularity) throw new OandaError(`OANDA has no ${input.timeframe} candles.`, null);
  const doFetch = input.fetchImpl ?? fetch;
  const host = HOSTS[input.environment ?? "practice"];
  const toMs = input.to.getTime();
  const bars: ParsedBar[] = [];
  let cursor = input.from.getTime();

  while (cursor < toMs) {
    const url = new URL(`/v3/instruments/${instrument}/candles`, host);
    url.searchParams.set("price", "BA");
    url.searchParams.set("granularity", granularity);
    url.searchParams.set("from", String(cursor / 1000));
    url.searchParams.set("count", String(MAX_COUNT));
    url.searchParams.set("dailyAlignment", "0");
    url.searchParams.set("alignmentTimezone", "UTC");
    url.searchParams.set("weeklyAlignment", "Monday");

    const res = await doFetch(url, {
      headers: { Authorization: `Bearer ${input.token}`, "Accept-Datetime-Format": "UNIX" },
      signal: AbortSignal.timeout(30_000),
    });
    const json = (await res.json().catch(() => null)) as { errorMessage?: string } | null;
    if (!res.ok) {
      throw new OandaError(json?.errorMessage ?? `OANDA answered ${res.status}.`, res.status);
    }
    const raw = (json as { candles?: OandaCandle[] } | null)?.candles ?? [];
    const page = parseOandaCandles(json, input.pointSize).filter((b) => b.ts >= cursor && b.ts < toMs);
    bars.push(...page);
    const lastRawTs = raw.length ? Math.round(Number.parseFloat(raw[raw.length - 1].time) * 1000) : NaN;
    // Done when the API ran short (nothing further: the range reached now,
    // or a weekend at the end of the window), or its last candle is already
    // past the range.
    if (raw.length < MAX_COUNT || !(lastRawTs < toMs - 1)) break;
    cursor = lastRawTs + 1;
  }
  return bars;
}

/** Bars a range would hold at most — weekends make the real number smaller.
 * The download action caps on this before asking OANDA for anything. */
export function estimatedBars(timeframe: Timeframe, from: Date, to: Date): number {
  return Math.max(0, Math.ceil((to.getTime() - from.getTime()) / BAR_MS[timeframe]));
}

/** How far back a fresh download reaches by default, per timeframe: enough
 * to practise on, well inside MAX_DOWNLOAD_BARS. */
const DEFAULT_DAYS: Record<Timeframe, number> = {
  M1: 7,
  M5: 21,
  M15: 60,
  M30: 90,
  H1: 180,
  H4: 365,
  D1: 3 * 365,
  W1: 5 * 365,
};

/** A default [from, to] in UTC calendar dates, ending yesterday. */
export function defaultDownloadRange(timeframe: Timeframe, now = new Date()): { from: string; to: string } {
  const day = 86_400_000;
  const to = new Date(Math.floor(now.getTime() / day) * day - day);
  const from = new Date(to.getTime() - (DEFAULT_DAYS[timeframe] - 1) * day);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}
