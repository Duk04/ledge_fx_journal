import "server-only";
import { Prisma, type Execution, type ExecutionKind } from "@prisma/client";
import { aggregateFills, simpleFills, type Fill } from "@/lib/metrics/fills";
import { derivedColumns, tradeInput } from "@/lib/trade-service";

/**
 * The write side of executions (lib/metrics/fills.ts is the arithmetic).
 * Not a "use server" module: these take a transaction client and trust their
 * caller to have checked ownership already — they are helpers for actions,
 * not endpoints.
 */

type Tx = Prisma.TransactionClient;

export function toFill(e: Pick<Execution, "kind" | "executedAt" | "price" | "volumeLots">): Fill {
  return { kind: e.kind, executedAt: e.executedAt, price: e.price.toString(), volumeLots: e.volumeLots.toString() };
}

/** Nested-create payload for the fills a one-shot trade stands for. A
 * CANCELLED trade never filled and gets none. */
export function simpleExecutionsCreate(trade: {
  status: string;
  openedAt: Date;
  entryPrice: Prisma.Decimal.Value;
  volumeLots: Prisma.Decimal.Value;
  closedAt?: Date | null;
  exitPrice?: Prisma.Decimal.Value | null;
}): { kind: ExecutionKind; executedAt: Date; price: string; volumeLots: string }[] {
  if (trade.status === "CANCELLED") return [];
  return simpleFills({ ...trade, closedAt: trade.status === "CLOSED" ? trade.closedAt : null }).map((f) => ({
    kind: f.kind,
    executedAt: f.executedAt,
    price: String(f.price),
    volumeLots: String(f.volumeLots),
  }));
}

/** True when a trade has more than one entry OR more than one exit — i.e.
 * when the plain trade form (one entry, one exit) can no longer describe it. */
export function hasMultipleFills(executions: Pick<Execution, "kind">[]): boolean {
  const entries = executions.filter((e) => e.kind === "ENTRY").length;
  const exits = executions.filter((e) => e.kind === "EXIT").length;
  return entries > 1 || exits > 1;
}

/**
 * Re-derive a trade from its executions: the aggregate columns (entry, exit,
 * volume, opened, closed, status) and then every derived analytics column,
 * through the same trade-service path a hand-entered trade takes. Call after
 * any change to a trade's executions, inside the same transaction.
 */
export async function syncTradeFromFills(tx: Tx, tradeId: string, accountCurrency: string) {
  const trade = await tx.trade.findUniqueOrThrow({
    where: { id: tradeId },
    include: { instrument: true, executions: true },
  });
  if (trade.status === "CANCELLED" || trade.executions.length === 0) return trade;

  const agg = aggregateFills(trade.executions.map(toFill));
  const next = {
    ...trade,
    entryPrice: new Prisma.Decimal(agg.entryPrice.toString()),
    exitPrice: agg.exitPrice ? new Prisma.Decimal(agg.exitPrice.toString()) : null,
    volumeLots: new Prisma.Decimal(agg.volumeLots.toString()),
    openedAt: agg.openedAt,
    closedAt: agg.closedAt,
    status: agg.status,
  };
  return tx.trade.update({
    where: { id: tradeId },
    data: {
      entryPrice: next.entryPrice,
      exitPrice: next.exitPrice,
      volumeLots: next.volumeLots,
      openedAt: next.openedAt,
      closedAt: next.closedAt,
      status: next.status,
      ...derivedColumns(tradeInput(next, trade.instrument, accountCurrency)),
    },
  });
}
