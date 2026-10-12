"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { ok, type ActionResult } from "../result";
import { guardNotFound } from "../guard";
import { NotFoundError, requireUser } from "@/lib/session";
import { tr } from "@/i18n/server-t";

/**
 * Deletes a run and its trades (the FK from Trade -> BacktestRun cascades —
 * see prisma/schema.prisma). The run's own account is cleaned up too, but
 * only once nothing else points at it: the schema allows an account to hold
 * more than one run, even though every creation path here only ever makes
 * one-run-per-account accounts, so this checks rather than assumes.
 */
export async function deleteRun(id: string): Promise<ActionResult> {
  const user = await requireUser();

  // `guardNotFound` converts the NotFoundError thrown inside the transaction
  // into a failure result. Thrown rather than returned there on purpose: a
  // `return` from the callback would COMMIT the transaction, and the point of
  // throwing is to roll back whatever it had already done.
  return guardNotFound(async () => {
    await prisma.$transaction(async (tx) => {
      const run = await tx.backtestRun.findFirst({ where: { id, userId: user.id } });
      if (!run) throw new NotFoundError(await tr("runNotFound"));

      await tx.backtestRun.delete({ where: { id } });

      const remaining = await tx.backtestRun.count({ where: { accountId: run.accountId } });
      if (remaining === 0) {
        await tx.tradingAccount.delete({ where: { id: run.accountId } });
      }
    });

    revalidatePath("/backtest");
    return ok();
  });
}
