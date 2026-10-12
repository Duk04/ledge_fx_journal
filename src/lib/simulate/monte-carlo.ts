/**
 * Monte Carlo on your own R multiples: shuffle the order of outcomes you have
 * actually produced (sampling with replacement), many times, and look at the
 * spread of where that could have left the account. It answers "was my
 * equity curve luck?" and "how deep a drawdown should I expect from this
 * edge at this size?" — not "what will happen", since it assumes the past
 * distribution of R holds.
 *
 * Sizing is a fixed percent of the running balance per trade, so outcomes
 * compound, as they do for a trader who sizes by percent. Deterministic for
 * a given seed (mulberry32), so a page reload shows the same picture and the
 * tests can pin numbers.
 */

export interface MonteCarloInput {
  rMultiples: readonly number[];
  startingBalance: number;
  riskPct: number;
  tradesPerRun: number;
  runs: number;
  /** A drawdown, in percent of the peak, that counts as "ruin" for you. */
  ruinDrawdownPct: number;
  seed?: number;
}

export interface MonteCarloResult {
  /** Final balance percentiles across runs. */
  final: { p5: number; p25: number; p50: number; p75: number; p95: number };
  /** Max drawdown (percent of peak) percentiles across runs. */
  maxDrawdownPct: { p50: number; p95: number };
  /** Share of runs that ever fell `ruinDrawdownPct` below their peak. */
  ruinProbability: number;
  /** Share of runs that finished below the starting balance. */
  lossProbability: number;
  /** Five sample equity paths (balance after each trade) for a chart. */
  samplePaths: number[][];
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[i];
}

export function runMonteCarlo(input: MonteCarloInput): MonteCarloResult | null {
  const { rMultiples, startingBalance, riskPct, tradesPerRun, runs, ruinDrawdownPct } = input;
  if (rMultiples.length < 2 || runs < 1 || tradesPerRun < 1) return null;
  const rand = mulberry32(input.seed ?? 42);

  const finals: number[] = [];
  const maxDds: number[] = [];
  const samplePaths: number[][] = [];
  let ruined = 0;
  let lost = 0;

  for (let run = 0; run < runs; run++) {
    let balance = startingBalance;
    let peak = balance;
    let maxDd = 0;
    const path = run < 5 ? [balance] : null;
    for (let i = 0; i < tradesPerRun; i++) {
      const r = rMultiples[Math.floor(rand() * rMultiples.length)];
      balance += r * balance * (riskPct / 100);
      if (balance <= 0) balance = 0;
      peak = Math.max(peak, balance);
      maxDd = Math.max(maxDd, peak > 0 ? ((peak - balance) / peak) * 100 : 0);
      path?.push(balance);
    }
    finals.push(balance);
    maxDds.push(maxDd);
    if (maxDd >= ruinDrawdownPct) ruined++;
    if (balance < startingBalance) lost++;
    if (path) samplePaths.push(path);
  }

  finals.sort((a, b) => a - b);
  maxDds.sort((a, b) => a - b);
  return {
    final: {
      p5: percentile(finals, 5),
      p25: percentile(finals, 25),
      p50: percentile(finals, 50),
      p75: percentile(finals, 75),
      p95: percentile(finals, 95),
    },
    maxDrawdownPct: { p50: percentile(maxDds, 50), p95: percentile(maxDds, 95) },
    ruinProbability: ruined / runs,
    lossProbability: lost / runs,
    samplePaths,
  };
}
