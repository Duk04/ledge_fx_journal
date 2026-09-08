/**
 * Pure technical indicators over plain `number[]`. Every function returns an
 * array the SAME LENGTH as its input, using `null` to mark the warm-up
 * period where the indicator is not yet defined.
 *
 * This alignment rule is not cosmetic. A strategy reads `series[ctx.i]` on
 * every bar; if an indicator silently returned a shorter array (e.g. only
 * from where it becomes defined), every subsequent index would quietly line
 * up against the WRONG bar — a look-ahead bug that shows up not as a crash
 * but as suspiciously good backtest results, because the strategy would
 * effectively be reacting to indicator values computed from bars slightly in
 * its future. Returning `null` for the warm-up keeps the index honest.
 */

/** Rolling simple moving average. Defined from index `period - 1`. Maintains
 * a running sum so each step is O(1) rather than re-summing the window. */
export function sma(values: number[], period: number): (number | null)[] {
  assertPositivePeriod(period);
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/**
 * Exponential moving average, seeded with the SMA of the first `period`
 * values (the conventional seed) at index `period - 1`, then recursive
 * (incremental, O(1) per bar) from there: ema[i] = value[i] * k +
 * ema[i-1] * (1 - k), k = 2 / (period + 1).
 */
export function ema(values: number[], period: number): (number | null)[] {
  assertPositivePeriod(period);
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);

  let seedSum = 0;
  for (let i = 0; i < period; i++) seedSum += values[i];
  let prev = seedSum / period;
  out[period - 1] = prev;

  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/**
 * Wilder's RSI. Uses `period` price changes to seed the initial average
 * gain/loss (a simple average of deltas[1..period]) at index `period`, then
 * Wilder's smoothing (incremental, O(1) per bar) afterwards:
 *   avg = (avg * (period - 1) + current) / period
 *
 * Special cases match the standard definition: avgLoss === 0 (and avgGain >
 * 0) -> RSI 100; avgGain === 0 and avgLoss === 0 (flat prices) -> RSI 50, a
 * defensible "no information" midpoint rather than a division by zero.
 */
export function rsi(values: number[], period: number): (number | null)[] {
  assertPositivePeriod(period);
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length <= period) return out;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const delta = values[i] - values[i - 1];
    if (delta > 0) gainSum += delta;
    else lossSum -= delta;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = rsiFromAverages(avgGain, avgLoss);

  for (let i = period + 1; i < values.length; i++) {
    const delta = values[i] - values[i - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? -delta : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = rsiFromAverages(avgGain, avgLoss);
  }
  return out;
}

function rsiFromAverages(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Average True Range (Wilder). True range for bar `i` is the largest of:
 * high-low, |high - prevClose|, |low - prevClose|; bar 0 has no previous
 * close so its true range is simply high-low. Seeded with the SMA of the
 * first `period` true ranges at index `period - 1`, then Wilder-smoothed
 * (incremental) afterwards, same recurrence as `rsi`.
 */
export function atr(high: number[], low: number[], close: number[], period: number): (number | null)[] {
  assertPositivePeriod(period);
  const n = high.length;
  const out: (number | null)[] = new Array(n).fill(null);
  if (n < period) return out;

  const tr = new Array<number>(n);
  tr[0] = high[0] - low[0];
  for (let i = 1; i < n; i++) {
    tr[i] = Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1]));
  }

  let seedSum = 0;
  for (let i = 0; i < period; i++) seedSum += tr[i];
  let prev = seedSum / period;
  out[period - 1] = prev;

  for (let i = period; i < n; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

/**
 * Rolling POPULATION standard deviation (divide by n, not n-1) over a window
 * of `period` values, defined from index `period - 1`. Population, not
 * sample, is the conventional choice for rolling indicators such as
 * Bollinger Bands, which is the main consumer of this function.
 */
export function stdev(values: number[], period: number): (number | null)[] {
  assertPositivePeriod(period);
  const out: (number | null)[] = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j];
    const mean = sum / period;
    let sqSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = values[j] - mean;
      sqSum += diff * diff;
    }
    out[i] = Math.sqrt(sqSum / period);
  }
  return out;
}

/** Rolling maximum over a window of `period` values, defined from index `period - 1`. */
export function highest(values: number[], period: number): (number | null)[] {
  assertPositivePeriod(period);
  const out: (number | null)[] = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let max = -Infinity;
    for (let j = i - period + 1; j <= i; j++) if (values[j] > max) max = values[j];
    out[i] = max;
  }
  return out;
}

/** Rolling minimum over a window of `period` values, defined from index `period - 1`. */
export function lowest(values: number[], period: number): (number | null)[] {
  assertPositivePeriod(period);
  const out: (number | null)[] = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let min = Infinity;
    for (let j = i - period + 1; j <= i; j++) if (values[j] < min) min = values[j];
    out[i] = min;
  }
  return out;
}

/**
 * True at index `i` when `a` crossed strictly above `b` between `i - 1` and
 * `i` (a[i-1] <= b[i-1] and a[i] > b[i]). Unlike the indicators above, a
 * cross is an EVENT, not a computed value, so the warm-up (or any bar where
 * either series is null) is reported as `false` rather than `null` — "no
 * cross happened here" is a true statement even without enough data, and
 * forcing callers to juggle a third state for a boolean signal would invite
 * bugs of its own (e.g. `if (crossOver[i])` silently treating null as
 * falsy and masking the missing-data case anyway).
 */
export function crossOver(a: (number | null)[], b: (number | null)[]): boolean[] {
  return crossed(a, b, (prevA, prevB, curA, curB) => prevA <= prevB && curA > curB);
}

/** True at index `i` when `a` crossed strictly below `b` (mirror of `crossOver`). */
export function crossUnder(a: (number | null)[], b: (number | null)[]): boolean[] {
  return crossed(a, b, (prevA, prevB, curA, curB) => prevA >= prevB && curA < curB);
}

function crossed(
  a: (number | null)[],
  b: (number | null)[],
  test: (prevA: number, prevB: number, curA: number, curB: number) => boolean,
): boolean[] {
  const n = Math.max(a.length, b.length);
  const out = new Array<boolean>(n).fill(false);
  for (let i = 1; i < n; i++) {
    const prevA = a[i - 1];
    const prevB = b[i - 1];
    const curA = a[i];
    const curB = b[i];
    if (prevA === null || prevB === null || curA === null || curB === null) continue;
    out[i] = test(prevA, prevB, curA, curB);
  }
  return out;
}

function assertPositivePeriod(period: number): void {
  if (!Number.isInteger(period) || period < 1) {
    throw new Error(`period must be a positive integer, got ${period}`);
  }
}
