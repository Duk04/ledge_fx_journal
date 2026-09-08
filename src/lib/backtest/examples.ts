/**
 * The strategy templates the workbench offers.
 *
 * These live in their own module, apart from `sandbox.ts`, for a reason that
 * is structural rather than cosmetic: `sandbox.ts` contains `compileStrategy`,
 * which must never be reachable from a server module (see that file's header
 * for what it does and does not protect against). This list, by contrast, is
 * inert data that a *server component* renders — `app/(app)/backtest/
 * strategies/page.tsx` passes it to the workbench as templates.
 *
 * Keeping both in one file meant that server page's import pulled
 * `compileStrategy` back into the server's module graph, which is exactly how
 * arbitrary strategy code came to be compiled on the server in the first
 * place. Data here, compiler there.
 *
 * Each template is real, working code exercised against synthetic bars — not
 * illustrative pseudocode.
 */
export interface ExampleStrategy {
  name: string;
  description: string;
  params: Record<string, number | string | boolean>;
  code: string;
}

export const EMA_CROSS_STRATEGY: ExampleStrategy = {
  name: "EMA Cross",
  description: "Goes long when the fast EMA crosses above the slow EMA, short when it crosses below, with an ATR stop so every trade has an R multiple.",
  params: { fastPeriod: 10, slowPeriod: 30, atrPeriod: 14, atrMultiplier: 2, lots: 1 },
  code: `
function onBar(ctx) {
  var fastPeriod = Number(ctx.params.fastPeriod);
  var slowPeriod = Number(ctx.params.slowPeriod);
  var atrPeriod = Number(ctx.params.atrPeriod);
  var atrMultiplier = Number(ctx.params.atrMultiplier);
  var lots = Number(ctx.params.lots);
  if (ctx.bars.length <= slowPeriod + atrPeriod) return;

  var closes = ctx.bars.map(function (b) { return b.close; });
  var highs = ctx.bars.map(function (b) { return b.high; });
  var lows = ctx.bars.map(function (b) { return b.low; });

  var fast = ema(closes, fastPeriod);
  var slow = ema(closes, slowPeriod);
  var up = crossOver(fast, slow);
  var down = crossUnder(fast, slow);
  var atrValues = atr(highs, lows, closes, atrPeriod);
  var i = ctx.i;

  // Without a stop there is no risk to divide by, so every trade would report
  // a null R and the whole R-based half of the report would go blank. An ATR
  // stop also sizes the risk to how much this market is actually moving.
  var stopDistance = atrValues[i] === null ? null : atrValues[i] * atrMultiplier;
  if (stopDistance === null) return;

  if (!ctx.position) {
    if (up[i]) {
      ctx.buy({
        lots: lots,
        stopLoss: ctx.bar.close - stopDistance,
        takeProfit: ctx.bar.close + stopDistance * 2,
        reason: "fast EMA crossed above slow EMA"
      });
    } else if (down[i]) {
      ctx.sell({
        lots: lots,
        stopLoss: ctx.bar.close + stopDistance,
        takeProfit: ctx.bar.close - stopDistance * 2,
        reason: "fast EMA crossed below slow EMA"
      });
    }
    return;
  }

  if (ctx.position.side === "LONG" && down[i]) {
    ctx.close("fast EMA crossed back below slow EMA");
  } else if (ctx.position.side === "SHORT" && up[i]) {
    ctx.close("fast EMA crossed back above slow EMA");
  }
}
`.trim(),
};

export const RSI_MEAN_REVERSION_STRATEGY: ExampleStrategy = {
  name: "RSI Mean Reversion",
  description: "Buys oversold / sells overbought RSI extremes with an ATR-based stop, and exits back at the RSI midline.",
  params: { rsiPeriod: 14, oversold: 30, overbought: 70, atrPeriod: 14, atrMultiplier: 2, lots: 1 },
  code: `
function onBar(ctx) {
  var rsiPeriod = Number(ctx.params.rsiPeriod);
  var oversold = Number(ctx.params.oversold);
  var overbought = Number(ctx.params.overbought);
  var atrPeriod = Number(ctx.params.atrPeriod);
  var atrMultiplier = Number(ctx.params.atrMultiplier);
  var lots = Number(ctx.params.lots);
  if (ctx.bars.length <= Math.max(rsiPeriod, atrPeriod)) return;

  var closes = ctx.bars.map(function (b) { return b.close; });
  var highs = ctx.bars.map(function (b) { return b.high; });
  var lows = ctx.bars.map(function (b) { return b.low; });
  var rsiSeries = rsi(closes, rsiPeriod);
  var atrSeries = atr(highs, lows, closes, atrPeriod);
  var i = ctx.i;
  var currentRsi = rsiSeries[i];
  var currentAtr = atrSeries[i];
  if (currentRsi === null || currentAtr === null) return;

  if (!ctx.position) {
    if (currentRsi < oversold) {
      ctx.buy({
        lots: lots,
        stopLoss: ctx.bar.close - currentAtr * atrMultiplier,
        reason: "RSI oversold (" + currentRsi.toFixed(1) + ")",
      });
    } else if (currentRsi > overbought) {
      ctx.sell({
        lots: lots,
        stopLoss: ctx.bar.close + currentAtr * atrMultiplier,
        reason: "RSI overbought (" + currentRsi.toFixed(1) + ")",
      });
    }
    return;
  }

  if (ctx.position.side === "LONG" && currentRsi >= 50) {
    ctx.close("RSI reverted to midline");
  } else if (ctx.position.side === "SHORT" && currentRsi <= 50) {
    ctx.close("RSI reverted to midline");
  }
}
`.trim(),
};

export const LONDON_BREAKOUT_STRATEGY: ExampleStrategy = {
  name: "London Breakout",
  description: "Tracks the high/low of the opening minutes of the London session, then trades a breakout of that range for the rest of the session.",
  params: { rangeMinutes: 60, stopBufferPips: 5, lots: 1 },
  code: `
var rangeHigh = null;
var rangeLow = null;
var sessionDayKey = null;
var tradedToday = false;

function dayKey(ts) {
  var d = new Date(ts);
  return d.getUTCFullYear() + "-" + d.getUTCMonth() + "-" + d.getUTCDate();
}

function onBar(ctx) {
  var rangeMinutes = Number(ctx.params.rangeMinutes);
  var stopBufferPips = Number(ctx.params.stopBufferPips);
  var lots = Number(ctx.params.lots);

  var d = new Date(ctx.bar.ts);
  var hour = d.getUTCHours();
  var minute = d.getUTCMinutes();
  var key = dayKey(ctx.bar.ts);

  if (key !== sessionDayKey) {
    sessionDayKey = key;
    rangeHigh = null;
    rangeLow = null;
    tradedToday = false;
  }

  // London opens 07:00 UTC.
  var minutesSinceOpen = (hour - 7) * 60 + minute;

  if (hour >= 16) {
    if (ctx.position) ctx.close("London session ended");
    return;
  }

  var inRangeWindow = minutesSinceOpen >= 0 && minutesSinceOpen < rangeMinutes;
  if (inRangeWindow) {
    rangeHigh = rangeHigh === null ? ctx.bar.high : Math.max(rangeHigh, ctx.bar.high);
    rangeLow = rangeLow === null ? ctx.bar.low : Math.min(rangeLow, ctx.bar.low);
    return;
  }

  var inTradingWindow = minutesSinceOpen >= rangeMinutes;
  if (!inTradingWindow || rangeHigh === null || rangeLow === null || tradedToday || ctx.position) return;

  var pip = ctx.instrument.pipSize;
  var span = rangeHigh - rangeLow;

  if (ctx.bar.close > rangeHigh) {
    tradedToday = true;
    ctx.buy({
      lots: lots,
      stopLoss: rangeLow - stopBufferPips * pip,
      takeProfit: ctx.bar.close + span,
      reason: "broke above the London opening range",
    });
  } else if (ctx.bar.close < rangeLow) {
    tradedToday = true;
    ctx.sell({
      lots: lots,
      stopLoss: rangeHigh + stopBufferPips * pip,
      takeProfit: ctx.bar.close - span,
      reason: "broke below the London opening range",
    });
  }
}
`.trim(),
};

export const EXAMPLE_STRATEGIES: ExampleStrategy[] = [
  EMA_CROSS_STRATEGY,
  RSI_MEAN_REVERSION_STRATEGY,
  LONDON_BREAKOUT_STRATEGY,
];
