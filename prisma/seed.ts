/**
 * Idempotent database seed.
 *
 * Safe to re-run: every row is created with a fixed, deterministic id (or
 * looked up by its natural unique key) and written via `upsert`, so running
 * `npm run db:seed` twice leaves the same rows in place instead of
 * duplicating them.
 *
 * All "randomness" here comes from a hand-rolled mulberry32 PRNG seeded
 * with a fixed constant (see `rand` below) — never `Math.random()` — so
 * the generated trades/dates/prices are byte-for-byte reproducible across
 * machines and runs.
 *
 * IMPORTANT: the Trade model's computed-and-stored columns (netPnl,
 * grossPnl, pips, rMultiple, riskAmount, holdingMinutes, marketSession)
 * are deliberately left NULL here. They are derived values with real
 * business logic (pip conversion, R-multiple vs. stop distance, session
 * boundaries in the account's timezone, etc.) that belongs in a single
 * shared `lib/metrics` backfill function, not duplicated/guessed in a
 * seed script. Run that backfill after seeding to populate them.
 */
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/db";
import { seedInstruments } from "../src/lib/instruments";

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) — do not use Math.random() in this file.
// ---------------------------------------------------------------------------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 20260824; // fixed seed -> reproducible data every run
const rand = mulberry32(SEED);

function randInt(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}
function randFloat(min: number, max: number): number {
  return rand() * (max - min) + min;
}
function pick<T>(arr: readonly T[]): T {
  return arr[randInt(0, arr.length - 1)];
}
function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-08-24T12:00:00.000Z");

// ---------------------------------------------------------------------------
// Fixed ids so every entity can be upserted deterministically.
// ---------------------------------------------------------------------------
const USER_ID = "seed-user-duk";
const ACCOUNT_FTMO_ID = "seed-acct-ftmo";
const ACCOUNT_LIVE_ID = "seed-acct-live";

const TAGS: Array<{ id: string; name: string; kind: "SETUP" | "MISTAKE"; color: string; sortOrder: number }> = [
  { id: "seed-tag-ob-retest", name: "OB retest", kind: "SETUP", color: "#33488F", sortOrder: 0 },
  { id: "seed-tag-fvg-fill", name: "FVG fill", kind: "SETUP", color: "#3F6FBF", sortOrder: 1 },
  { id: "seed-tag-liquidity-sweep", name: "Liquidity sweep", kind: "SETUP", color: "#2E9E83", sortOrder: 2 },
  { id: "seed-tag-break-retest", name: "Break & retest", kind: "SETUP", color: "#4F8FD1", sortOrder: 3 },
  { id: "seed-tag-news-fade", name: "News fade / chased entry", kind: "MISTAKE", color: "#C0503C", sortOrder: 4 },
  { id: "seed-tag-no-sl", name: "No stop loss", kind: "MISTAKE", color: "#B23A48", sortOrder: 5 },
  { id: "seed-tag-moved-sl", name: "Moved SL", kind: "MISTAKE", color: "#B26A3A", sortOrder: 6 },
  { id: "seed-tag-revenge", name: "Revenge trade", kind: "MISTAKE", color: "#9C3A6E", sortOrder: 7 },
  { id: "seed-tag-oversized", name: "Oversized", kind: "MISTAKE", color: "#A1442E", sortOrder: 8 },
  { id: "seed-tag-early-exit", name: "Early exit", kind: "MISTAKE", color: "#8A5A2E", sortOrder: 9 },
];

// Trade symbols used in the seed, with a plausible base price to wiggle
// around and the pip size to move by (pulled from lib/instruments so the
// two stay in sync).
const TRADE_SYMBOLS = ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD", "NAS100"] as const;
const BASE_PRICE: Record<(typeof TRADE_SYMBOLS)[number], number> = {
  EURUSD: 1.0855,
  GBPUSD: 1.271,
  USDJPY: 154.8,
  XAUUSD: 2452.0,
  NAS100: 19480.0,
};

const NOTE_POOL = [
  "Waited for confirmation candle, entry felt clean.",
  "Should have sized down given the upcoming news release.",
  "Textbook retest of the order block, held the trade to target.",
  "Got impatient and entered before price tapped the zone.",
  "Session open was choppy, this probably wasn't a real setup.",
  "Solid R:R, followed the plan from pre-market notes exactly.",
  "Moved stop to breakeven too early, got stopped and it reversed.",
  "Chased the move after missing the first leg. Won't do that again.",
  "Clean liquidity sweep of the prior day's low before reversing.",
  "Oversized this one after two losses — need to reset risk after a loss.",
];

/**
 * `--instruments-only` (npm run db:seed:instruments): the production seed.
 * Inserts the instruments that are missing and touches nothing else:
 *  - no demo user — duk@example.com / "password" as OWNER on a public
 *    deployment would hand the instance to whoever reads this file;
 *  - no overwrite — an owner's own pip-size or contract-size edits survive,
 *    which is why it can run on every deploy (vercel-build).
 * The full seed below still re-syncs every instrument to its spec, which is
 * what a local database wants.
 */
const INSTRUMENTS_ONLY = process.argv.includes("--instruments-only");

async function main() {
  if (INSTRUMENTS_ONLY) {
    const { count } = await prisma.instrument.createMany({
      data: seedInstruments.map((inst) => ({
        symbol: inst.symbol,
        displayName: inst.displayName,
        pipSize: inst.pipSize,
        contractSize: inst.contractSize,
        digits: inst.digits,
        baseCurrency: inst.baseCurrency,
        quoteCurrency: inst.quoteCurrency,
        assetClass: inst.assetClass,
      })),
      skipDuplicates: true,
    });
    console.log(`Added ${count} missing instruments (of ${seedInstruments.length}); existing rows untouched.`);
    return;
  }

  // -------------------------------------------------------------------
  // Instruments (all of them — reference data, no user scoping)
  // -------------------------------------------------------------------
  for (const inst of seedInstruments) {
    await prisma.instrument.upsert({
      where: { symbol: inst.symbol },
      update: {
        displayName: inst.displayName,
        pipSize: inst.pipSize,
        contractSize: inst.contractSize,
        digits: inst.digits,
        baseCurrency: inst.baseCurrency,
        quoteCurrency: inst.quoteCurrency,
        assetClass: inst.assetClass,
        isActive: true,
      },
      create: {
        symbol: inst.symbol,
        displayName: inst.displayName,
        pipSize: inst.pipSize,
        contractSize: inst.contractSize,
        digits: inst.digits,
        baseCurrency: inst.baseCurrency,
        quoteCurrency: inst.quoteCurrency,
        assetClass: inst.assetClass,
      },
    });
  }
  console.log(`Seeded ${seedInstruments.length} instruments.`);

  // -------------------------------------------------------------------
  // Demo user
  // -------------------------------------------------------------------
  const passwordHash = bcrypt.hashSync("password", 10);
  const user = await prisma.user.upsert({
    where: { email: "duk@example.com" },
    update: { name: "Duk", passwordHash, role: "OWNER", timezone: "Asia/Ulaanbaatar" },
    create: {
      id: USER_ID,
      email: "duk@example.com",
      name: "Duk",
      passwordHash,
      role: "OWNER",
      timezone: "Asia/Ulaanbaatar",
    },
  });
  console.log(`Seeded user ${user.email}.`);

  // -------------------------------------------------------------------
  // Trading accounts
  // -------------------------------------------------------------------
  const ftmoAccount = await prisma.tradingAccount.upsert({
    where: { id: ACCOUNT_FTMO_ID },
    update: {},
    create: {
      id: ACCOUNT_FTMO_ID,
      userId: user.id,
      label: "FTMO 50k Challenge",
      broker: "FTMO",
      platform: "MT5",
      accountType: "PROP",
      currency: "USD",
      startingBalance: "50000.00",
      riskPerTradePct: "1.000",
    },
  });

  const liveAccount = await prisma.tradingAccount.upsert({
    where: { id: ACCOUNT_LIVE_ID },
    update: {},
    create: {
      id: ACCOUNT_LIVE_ID,
      userId: user.id,
      label: "Live — IC Markets",
      broker: "IC Markets",
      platform: "CTRADER",
      accountType: "LIVE",
      currency: "USD",
      startingBalance: "10000.00",
      riskPerTradePct: "0.500",
    },
  });
  console.log(`Seeded 2 trading accounts.`);

  // -------------------------------------------------------------------
  // Tags
  // -------------------------------------------------------------------
  const tagIdByName = new Map<string, string>();
  for (const tag of TAGS) {
    const row = await prisma.tag.upsert({
      where: { userId_kind_name: { userId: user.id, kind: tag.kind, name: tag.name } },
      update: { color: tag.color, sortOrder: tag.sortOrder },
      create: {
        id: tag.id,
        userId: user.id,
        name: tag.name,
        kind: tag.kind,
        color: tag.color,
        sortOrder: tag.sortOrder,
      },
    });
    tagIdByName.set(tag.name, row.id);
  }
  const setupTagNames = TAGS.filter((t) => t.kind === "SETUP").map((t) => t.name);
  const mistakeTagNames = TAGS.filter((t) => t.kind === "MISTAKE").map((t) => t.name);
  console.log(`Seeded ${TAGS.length} tags.`);

  // -------------------------------------------------------------------
  // Trades: 43 closed + 2 open, spread over the last 90 days.
  // ~45% win rate, winners bigger (in pips) than losers on average, two
  // deliberate losing streaks, mixed across both accounts.
  // -------------------------------------------------------------------
  const CLOSED_COUNT = 43;
  const WIN_COUNT = 19; // ~44% win rate

  // Build the win/loss sequence in chronological order, with two forced
  // losing streaks (a 4-in-a-row and a 3-in-a-row) placed roughly a third
  // and two-thirds of the way through the period.
  const outcomes: boolean[] = new Array(CLOSED_COUNT).fill(false);
  {
    let winsToPlace = WIN_COUNT;
    const streakAIndex = 13; // 0-based start of the 4-loss streak
    const streakBIndex = 30; // 0-based start of the 3-loss streak
    const lossStreakIndices = new Set<number>([
      streakAIndex,
      streakAIndex + 1,
      streakAIndex + 2,
      streakAIndex + 3,
      streakBIndex,
      streakBIndex + 1,
      streakBIndex + 2,
    ]);
    const freeIndices = shuffle(
      Array.from({ length: CLOSED_COUNT }, (_, i) => i).filter((i) => !lossStreakIndices.has(i)),
    );
    for (const idx of freeIndices) {
      if (winsToPlace > 0) {
        outcomes[idx] = true;
        winsToPlace--;
      }
    }
    // lossStreakIndices are already `false` (their default) — deliberate losses.
  }

  // Chronological opened-at timestamps across the last 90 days.
  const openedTimestamps = Array.from({ length: CLOSED_COUNT + 2 }, () => {
    // The FX market is shut at the weekend, so a weekend timestamp would be
    // fiction — and every such trade would land in the OFFHOURS session,
    // making the session breakdown meaningless. Resample rather than clamp to
    // Friday: clamping piles half the sample onto one weekday and skews the
    // weekday breakdown just as badly.
    for (let attempt = 0; attempt < 12; attempt++) {
      const t = new Date(NOW.getTime() - randFloat(0.5, 90) * DAY_MS);
      // Mostly London/New York hours, with a fifth in the Asian session, so the
      // session breakdown has something real to compare rather than one bar.
      const hour = rand() < 0.2 ? randInt(0, 6) : randInt(7, 20);
      t.setUTCHours(hour, randInt(0, 59), 0, 0);
      const dow = t.getUTCDay();
      if (dow !== 0 && dow !== 6) return t;
    }
    // Deterministic fallback so the seed can never fail: the most recent Friday.
    const t = new Date(NOW.getTime());
    t.setUTCHours(14, 0, 0, 0);
    while (t.getUTCDay() !== 5) t.setUTCDate(t.getUTCDate() - 1);
    return t;
  }).sort((a, b) => a.getTime() - b.getTime());

  const externalTicketSeq = { [ACCOUNT_FTMO_ID]: 1000, [ACCOUNT_LIVE_ID]: 5000 } as Record<string, number>;

  let winPipsTotal = 0;
  let winCountActual = 0;
  let lossPipsTotal = 0;
  let lossCountActual = 0;

  for (let i = 0; i < CLOSED_COUNT; i++) {
    const symbol = pick(TRADE_SYMBOLS);
    const account = i % 2 === 0 ? ftmoAccount : liveAccount;
    const direction: "LONG" | "SHORT" = rand() < 0.5 ? "LONG" : "SHORT";
    const isWin = outcomes[i];
    const base = BASE_PRICE[symbol];
    const pipSize = symbol === "USDJPY" ? 0.01 : symbol === "XAUUSD" ? 0.01 : symbol === "NAS100" ? 1 : 0.0001;
    const priceDigits = symbol === "USDJPY" ? 3 : symbol === "XAUUSD" ? 2 : symbol === "NAS100" ? 1 : 5;

    // Wander the "market" a little around the base price using the day index.
    const drift = Math.sin(i / 5) * base * 0.01 + randFloat(-1, 1) * base * 0.003;
    const entryPrice = base + drift;

    // Winners move further (in pips) than losers on average.
    const movePips = isWin ? randFloat(18, 55) : randFloat(6, 22);
    const moveAmount = movePips * pipSize;
    const signForDirection = direction === "LONG" ? 1 : -1;
    const signForOutcome = isWin ? 1 : -1;
    const exitPrice = entryPrice + signForDirection * signForOutcome * moveAmount;

    const slDistance = randFloat(10, 25) * pipSize;
    const tpDistance = randFloat(25, 60) * pipSize;
    const stopLoss = entryPrice - signForDirection * slDistance;
    const takeProfit = entryPrice + signForDirection * tpDistance;

    const volumeLots = account.id === ACCOUNT_FTMO_ID ? randFloat(0.5, 2.0) : randFloat(0.1, 0.6);

    const openedAt = openedTimestamps[i];
    const holdingHours = randFloat(0.25, 30);
    const closedAt = new Date(openedAt.getTime() + holdingHours * 60 * 60 * 1000);

    const ticket = externalTicketSeq[account.id]++;

    const followedPlan = isWin ? rand() < 0.85 : rand() < 0.4;
    const emotion = randInt(1, 5);
    const confidence = rand() < 0.7 ? randInt(2, 5) : null;

    let notes: string | null = null;
    if (rand() < 0.35) {
      notes = pick(NOTE_POOL);
    }

    const trade = await prisma.trade.upsert({
      where: { id: `seed-trade-${String(i + 1).padStart(4, "0")}` },
      update: {},
      create: {
        id: `seed-trade-${String(i + 1).padStart(4, "0")}`,
        accountId: account.id,
        symbol,
        direction,
        status: "CLOSED",
        openedAt,
        closedAt,
        entryPrice: entryPrice.toFixed(priceDigits),
        exitPrice: exitPrice.toFixed(priceDigits),
        stopLoss: stopLoss.toFixed(priceDigits),
        takeProfit: takeProfit.toFixed(priceDigits),
        volumeLots: volumeLots.toFixed(2),
        // $7/lot, POSITIVE: the journal stores commission as a cost
        // (docs/METRICS.md). This used to be negative — the broker's sign —
        // which the formulas read as a rebate, so every seeded trade was
        // paid to trade instead of charged.
        commission: (volumeLots * 7).toFixed(2),
        swap: (rand() < 0.3 ? -randFloat(0.5, 4) : 0).toFixed(2),
        conversionRate: symbol.endsWith("USD") || symbol === "NAS100" ? "1.00000000" : null,
        followedPlan,
        emotion,
        confidence,
        notes,
        externalTicket: `${account.id === ACCOUNT_FTMO_ID ? "FTMO" : "ICM"}-${ticket}`,
        initialStopLoss: stopLoss.toFixed(priceDigits),
        // One entry, one exit — every trade's fills (lib/metrics/fills.ts).
        executions: {
          create: [
            {
              kind: "ENTRY",
              executedAt: openedAt,
              price: entryPrice.toFixed(priceDigits),
              volumeLots: volumeLots.toFixed(2),
            },
            {
              kind: "EXIT",
              executedAt: closedAt,
              price: exitPrice.toFixed(priceDigits),
              volumeLots: volumeLots.toFixed(2),
            },
          ],
        },
        // netPnl / grossPnl / pips / rMultiple / riskAmount / holdingMinutes /
        // marketSession are intentionally left NULL — backfilled later by
        // lib/metrics from the raw fields above.
      },
    });

    if (isWin) {
      winPipsTotal += movePips;
      winCountActual++;
    } else {
      lossPipsTotal += movePips;
      lossCountActual++;
    }

    // Attach a tag to about half the trades: setups on wins, mistakes on
    // losses (with a little overlap, same as real journals).
    if (rand() < 0.55) {
      const tagName = isWin ? pick(setupTagNames) : pick(mistakeTagNames);
      const tagId = tagIdByName.get(tagName)!;
      await prisma.tradeTag.upsert({
        where: { tradeId_tagId: { tradeId: trade.id, tagId } },
        update: {},
        create: { tradeId: trade.id, tagId },
      });
      // A handful of trades get a second tag too.
      if (rand() < 0.2) {
        const secondPool = isWin ? mistakeTagNames : setupTagNames;
        const secondTagName = pick(secondPool);
        const secondTagId = tagIdByName.get(secondTagName)!;
        if (secondTagId !== tagId) {
          await prisma.tradeTag.upsert({
            where: { tradeId_tagId: { tradeId: trade.id, tagId: secondTagId } },
            update: {},
            create: { tradeId: trade.id, tagId: secondTagId },
          });
        }
      }
    }
  }

  console.log(
    `Seeded ${CLOSED_COUNT} closed trades (${winCountActual} wins / ${lossCountActual} losses, ` +
      `avg winner ${(winPipsTotal / winCountActual).toFixed(1)} pips vs avg loss ${(
        lossPipsTotal / lossCountActual
      ).toFixed(1)} pips).`,
  );

  // -------------------------------------------------------------------
  // 2 open trades
  // -------------------------------------------------------------------
  for (let i = 0; i < 2; i++) {
    const symbol = pick(TRADE_SYMBOLS);
    const account = i === 0 ? ftmoAccount : liveAccount;
    const direction: "LONG" | "SHORT" = rand() < 0.5 ? "LONG" : "SHORT";
    const base = BASE_PRICE[symbol];
    const pipSize = symbol === "USDJPY" ? 0.01 : symbol === "XAUUSD" ? 0.01 : symbol === "NAS100" ? 1 : 0.0001;
    const priceDigits = symbol === "USDJPY" ? 3 : symbol === "XAUUSD" ? 2 : symbol === "NAS100" ? 1 : 5;
    const entryPrice = base + randFloat(-1, 1) * base * 0.002;
    const signForDirection = direction === "LONG" ? 1 : -1;
    const slDistance = randFloat(10, 25) * pipSize;
    const tpDistance = randFloat(25, 60) * pipSize;
    const stopLoss = entryPrice - signForDirection * slDistance;
    const takeProfit = entryPrice + signForDirection * tpDistance;
    const volumeLots = account.id === ACCOUNT_FTMO_ID ? randFloat(0.5, 2.0) : randFloat(0.1, 0.6);
    const openedAt = openedTimestamps[CLOSED_COUNT + i];
    const ticket = externalTicketSeq[account.id]++;

    await prisma.trade.upsert({
      where: { id: `seed-trade-open-${i + 1}` },
      update: {},
      create: {
        id: `seed-trade-open-${i + 1}`,
        accountId: account.id,
        symbol,
        direction,
        status: "OPEN",
        openedAt,
        entryPrice: entryPrice.toFixed(priceDigits),
        stopLoss: stopLoss.toFixed(priceDigits),
        takeProfit: takeProfit.toFixed(priceDigits),
        volumeLots: volumeLots.toFixed(2),
        // $7/lot, POSITIVE: the journal stores commission as a cost
        // (docs/METRICS.md). This used to be negative — the broker's sign —
        // which the formulas read as a rebate, so every seeded trade was
        // paid to trade instead of charged.
        commission: (volumeLots * 7).toFixed(2),
        swap: "0.00",
        conversionRate: symbol.endsWith("USD") || symbol === "NAS100" ? "1.00000000" : null,
        externalTicket: `${account.id === ACCOUNT_FTMO_ID ? "FTMO" : "ICM"}-${ticket}`,
        initialStopLoss: stopLoss.toFixed(priceDigits),
        executions: {
          create: [
            {
              kind: "ENTRY",
              executedAt: openedAt,
              price: entryPrice.toFixed(priceDigits),
              volumeLots: volumeLots.toFixed(2),
            },
          ],
        },
      },
    });
  }
  console.log("Seeded 2 open trades.");

  // -------------------------------------------------------------------
  // Balance events
  // -------------------------------------------------------------------
  const balanceEvents = [
    {
      id: "seed-balance-0001",
      accountId: ACCOUNT_FTMO_ID,
      kind: "ADJUSTMENT" as const,
      amount: "50000.00",
      occurredAt: new Date(NOW.getTime() - 90 * DAY_MS),
      note: "Challenge account starting balance credited by FTMO.",
    },
    {
      id: "seed-balance-0002",
      accountId: ACCOUNT_LIVE_ID,
      kind: "DEPOSIT" as const,
      amount: "10000.00",
      occurredAt: new Date(NOW.getTime() - 88 * DAY_MS),
      note: "Initial funding.",
    },
    {
      id: "seed-balance-0003",
      accountId: ACCOUNT_LIVE_ID,
      kind: "WITHDRAWAL" as const,
      amount: "1500.00",
      occurredAt: new Date(NOW.getTime() - 20 * DAY_MS),
      note: "Partial profit withdrawal.",
    },
  ];
  for (const ev of balanceEvents) {
    await prisma.balanceEvent.upsert({
      where: { id: ev.id },
      update: {},
      create: ev,
    });
  }
  console.log(`Seeded ${balanceEvents.length} balance events.`);

  // -------------------------------------------------------------------
  // Journal entries — ~12, spread across the last 90 days.
  // -------------------------------------------------------------------
  const journalDayOffsets = shuffle(Array.from({ length: 89 }, (_, i) => i + 1))
    .slice(0, 12)
    .sort((a, b) => b - a);
  const preMarketPool = [
    "Watching for a London open sweep of the Asia range before committing.",
    "High-impact NFP today — plan is to stand aside until 30 minutes after release.",
    "EURUSD compressing into a daily supply zone, want to see a clean rejection.",
    "Feeling well rested, sizing normally today.",
    "Gold ripped overnight, expecting a retrace to fill the gap before continuation.",
    "Low conviction day — reducing size and being selective.",
  ];
  const reviewPool = [
    "Stuck to the plan today, took only the A+ setup and sat out the rest.",
    "Forced a trade out of boredom in the New York lunch chop. Avoid this.",
    "Good discipline after the first loss — did not revenge trade.",
    "Let a winner run past target out of greed, gave back half the gain.",
    "Journal review: three of the last five losses were the same 'chased entry' mistake.",
    "Solid session, both trades followed the pre-market plan exactly.",
  ];
  let journalCount = 0;
  for (const offset of journalDayOffsets) {
    const entryDate = new Date(NOW.getTime() - offset * DAY_MS);
    entryDate.setUTCHours(0, 0, 0, 0);
    await prisma.journalEntry.upsert({
      where: { userId_entryDate: { userId: user.id, entryDate } },
      update: {},
      create: {
        userId: user.id,
        entryDate,
        preMarket: rand() < 0.8 ? pick(preMarketPool) : null,
        review: rand() < 0.8 ? pick(reviewPool) : null,
        mood: randInt(1, 5),
      },
    });
    journalCount++;
  }
  console.log(`Seeded ${journalCount} journal entries.`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
