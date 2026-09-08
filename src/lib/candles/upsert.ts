import "server-only";
import { Prisma, type CandleSource, type Timeframe } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { ParsedBar } from "@/lib/candles/parse";

/**
 * WHY THIS IS NOT IN `src/lib/actions/candles.ts` WITH ITS ONLY CALLER.
 *
 * It used to be, and it was exported from that module so `importCandles`
 * could reach it. That module starts with `"use server"`, and in Next.js
 * every export of such a module becomes a callable POST endpoint — reachable
 * directly, not only through the UI that happens to call it. Next's
 * data-security guide states it plainly: "even if a Server Action or utility
 * function is not imported elsewhere in your code, it can still be called
 * externally."
 *
 * This function takes pre-parsed rows and performs no authorization of its
 * own, because its caller does. Exported from a `"use server"` module, that
 * combination published an unauthenticated bulk write into the shared
 * `candles` table: anyone able to POST to the action id could overwrite any
 * user's stored bars with arbitrary OHLC, or insert unbounded rows until the
 * storage budget was gone. The foreign key on `Candle.symbol` limited targets
 * to known instruments; it did not limit the damage.
 *
 * Next offers no way to keep a helper private inside a `"use server"` module
 * — there is no "internal export" escape hatch, since every export must be
 * an async function it can assign an id to. A separate module is the only
 * mechanism. `import "server-only"` then makes it a build error for a client
 * component to pull this in, and `src/lib/candles/` is where it belongs
 * anyway: `parse.ts` and `aggregate.ts` are already here.
 *
 * Deliberately NOT adding `requireUser()` here: `importCandles` authenticates
 * before it ever gets this far, and a second check inside an internal helper
 * creates exactly the "which one is authoritative?" ambiguity this codebase
 * avoids elsewhere. The rule is that the action authenticates; this is not an
 * action.
 */
const UPSERT_BATCH_SIZE = 1000;

/**
 * Bulk upsert via raw `INSERT ... ON CONFLICT (symbol, timeframe, ts) DO
 * UPDATE`, batched at ~1000 rows per statement.
 *
 * `prisma.candle.createMany({ skipDuplicates: true })` is the wrong tool
 * here even though it looks like the obvious one: `skipDuplicates` means a
 * row whose primary key already exists is silently left as-is. Re-importing
 * an overlapping range — pulling "last 3 months" again next week, or fixing
 * a broker export that had wrong ticks — must REPLACE the stored bar with
 * whatever the new file says, not preserve the old one. The composite
 * primary key `(symbol, timeframe, ts)` (see prisma/schema.prisma) exists
 * specifically so this can be a plain upsert instead of a dedupe step the
 * caller has to run first.
 *
 * There's no batch-upsert call in Prisma's generated client (only
 * single-row `upsert`, which would mean one round trip per bar — several
 * hundred thousand of them for a year of M1), so this drops to raw SQL, one
 * multi-row statement per batch. `xmax = 0` is the standard Postgres trick
 * for telling an insert from an on-conflict update apart in the same
 * `RETURNING` clause: a freshly inserted row's xmax (the transaction id
 * that would eventually delete/supersede it) is unset, while a row reached
 * via the UPDATE branch of the conflict clause has it set to the current
 * transaction.
 */
export async function upsertCandles(
  symbol: string,
  timeframe: Timeframe,
  source: CandleSource,
  rows: readonly ParsedBar[],
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;

  for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + UPSERT_BATCH_SIZE);
    const values = Prisma.join(
      batch.map(
        (r) =>
          Prisma.sql`(${symbol}, ${timeframe}::"Timeframe", ${new Date(r.ts)}::timestamptz, ${r.open}, ${r.high}, ${r.low}, ${r.close}, ${r.volume ?? null}, ${r.spread ?? null}, ${source}::"CandleSource")`,
      ),
    );

    const result = await prisma.$queryRaw<{ inserted: boolean }[]>`
      INSERT INTO "candles" ("symbol", "timeframe", "ts", "open", "high", "low", "close", "volume", "spread", "source")
      VALUES ${values}
      ON CONFLICT ("symbol", "timeframe", "ts") DO UPDATE SET
        "open" = EXCLUDED."open",
        "high" = EXCLUDED."high",
        "low" = EXCLUDED."low",
        "close" = EXCLUDED."close",
        "volume" = EXCLUDED."volume",
        "spread" = EXCLUDED."spread",
        "source" = EXCLUDED."source"
      RETURNING (xmax = 0) AS inserted
    `;

    for (const row of result) {
      if (row.inserted) inserted += 1;
      else updated += 1;
    }
  }

  return { inserted, updated };
}
