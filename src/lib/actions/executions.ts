"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { validateFills } from "@/lib/metrics/fills";
import { accountOrFailure } from "./guard";
import { FillsChanged, assertFills, lockExecutions, syncTradeFromFills, toFill } from "./fills-store";
import { fail, ok, type ActionResult } from "./result";
import { failT, failZod, tr } from "@/i18n/server-t";
import { vmsg } from "@/i18n/encoded";

/**
 * Adding and removing individual fills: scaling in, partial closes, fixing a
 * mistyped fill. After every change the trade is re-derived from its fills
 * (syncTradeFromFills), so the trade row can never disagree with them.
 * docs/TRADES.md, "Executions".
 */

const fillSchema = z.object({
  kind: z.enum(["ENTRY", "EXIT"]),
  executedAt: z.coerce.date({ error: vmsg("timeRequired") }),
  price: z.coerce
    .number({ error: vmsg("priceRequired") })
    .finite()
    .positive(vmsg("pricePositive")),
  volumeLots: z.coerce
    .number({ error: vmsg("volumeRequired") })
    .finite()
    .positive(vmsg("volumePositive")),
});

async function tradeForAccount(accountId: string, tradeId: string) {
  const found = await accountOrFailure(accountId);
  if ("failure" in found) return found;
  const trade = await prisma.trade.findFirst({
    where: { id: tradeId, accountId: found.account.id },
    include: { executions: true },
  });
  if (!trade) return { failure: await failT("tradeNotFound") };
  if (trade.status === "CANCELLED") return { failure: fail("A cancelled trade has no fills to change.") };
  // An R-mode trade has no prices, so no fills to add or remove.
  if (trade.entryMode === "R_MULTIPLE") return { failure: await failT("rTradeNoFills") };
  return { account: found.account, trade };
}

function revalidate(tradeId: string) {
  revalidatePath("/trades");
  revalidatePath(`/trades/${tradeId}`);
  revalidatePath("/");
}

export async function addExecution(
  accountId: string,
  tradeId: string,
  input: { kind: string; executedAt: string | Date; price: string | number; volumeLots: string | number },
): Promise<ActionResult<{ status: "OPEN" | "CLOSED" }>> {
  const found = await tradeForAccount(accountId, tradeId);
  if ("failure" in found) return found.failure;

  const parsed = fillSchema.safeParse(input);
  if (!parsed.success) return failZod(parsed.error.flatten().fieldErrors as Record<string, string[]>);

  const problems = validateFills([...found.trade.executions.map(toFill), parsed.data]);
  if (problems.length) return fail(problems[0].message);

  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      assertFills([...(await lockExecutions(tx, tradeId)).map(toFill), parsed.data]);
      await tx.execution.create({
        data: {
          tradeId,
          kind: parsed.data.kind,
          executedAt: parsed.data.executedAt,
          price: parsed.data.price.toString(),
          volumeLots: parsed.data.volumeLots.toString(),
        },
      });
      return syncTradeFromFills(tx, tradeId, found.account.currency);
    });
  } catch (err) {
    if (err instanceof FillsChanged) return fail(err.message);
    throw err;
  }

  revalidate(tradeId);
  return ok({ status: updated.status === "CLOSED" ? "CLOSED" : "OPEN" });
}

export async function deleteExecution(
  accountId: string,
  tradeId: string,
  executionId: string,
): Promise<ActionResult<{ status: "OPEN" | "CLOSED" }>> {
  const found = await tradeForAccount(accountId, tradeId);
  if ("failure" in found) return found.failure;

  const target = found.trade.executions.find((e) => e.id === executionId);
  if (!target) return failT("fillNotFound");

  const remaining = found.trade.executions.filter((e) => e.id !== executionId);
  const problems = validateFills(remaining.map(toFill));
  if (problems.length) {
    return fail(problems[0].code === "NO_ENTRY" ? await tr("onlyEntryFill") : problems[0].message);
  }

  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      const current = await lockExecutions(tx, tradeId);
      // Re-checked under the lock: removed in another tab meanwhile, or the
      // fills left behind would no longer describe a position.
      if (!current.some((e) => e.id === executionId)) throw new FillsChanged(await tr("fillNotFound"));
      const rest = validateFills(current.filter((e) => e.id !== executionId).map(toFill));
      if (rest.length) {
        throw new FillsChanged(rest[0].code === "NO_ENTRY" ? await tr("onlyEntryFill") : rest[0].message);
      }
      await tx.execution.delete({ where: { id: executionId } });
      return syncTradeFromFills(tx, tradeId, found.account.currency);
    });
  } catch (err) {
    if (err instanceof FillsChanged) return fail(err.message);
    throw err;
  }

  revalidate(tradeId);
  return ok({ status: updated.status === "CLOSED" ? "CLOSED" : "OPEN" });
}
