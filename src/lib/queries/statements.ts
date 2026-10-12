import "server-only";
import { prisma } from "@/lib/db";

/** The account's recent statement imports, for the import page's history
 * list (and its undo buttons). Scoped by user AND account. */
export async function listRecentImports(userId: string, accountId: string, take = 10) {
  const rows = await prisma.tradeImport.findMany({
    where: { userId, accountId },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      source: true,
      fileName: true,
      tzMode: true,
      tzOffsetMinutes: true,
      tradesCreated: true,
      tradesSkipped: true,
      balanceEvents: true,
      createdAt: true,
      _count: { select: { trades: true } },
    },
  });
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), tradesRemaining: r._count.trades }));
}

export type RecentImport = Awaited<ReturnType<typeof listRecentImports>>[number];
