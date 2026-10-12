import "server-only";
import { prisma } from "@/lib/db";
import { toTradeRow } from "@/lib/trade-service";
import { playbookStats } from "@/lib/playbook-stats";
import { serializeSummary, type SerializedSummary } from "@/lib/queries/analytics/serialize";

export interface PlaybookView {
  id: string;
  name: string;
  description: string | null;
  isArchived: boolean;
  rules: { id: string; text: string; answered: number; followed: number }[];
  all: SerializedSummary;
  byTheBook: SerializedSummary;
  brokeARule: SerializedSummary;
  compliance: number | null;
}

/** Every playbook of the user, with stats over its trades in the given
 * account (closed and open; the summaries count closed ones). */
export async function listPlaybooks(userId: string, accountId: string): Promise<PlaybookView[]> {
  const playbooks = await prisma.playbook.findMany({
    where: { userId },
    orderBy: [{ isArchived: "asc" }, { name: "asc" }],
    include: {
      rules: { orderBy: { sortOrder: "asc" } },
      trades: {
        where: { accountId, account: { userId } },
        include: { ruleChecks: { select: { ruleId: true, followed: true } } },
      },
    },
  });
  return playbooks.map((p) => {
    const stats = playbookStats(
      p.rules.map((r) => r.id),
      p.trades.map((t) => ({ row: toTradeRow(t), checks: t.ruleChecks })),
    );
    const perRule = new Map(stats.rules.map((r) => [r.ruleId, r]));
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      isArchived: p.isArchived,
      rules: p.rules.map((r) => ({
        id: r.id,
        text: r.text,
        answered: perRule.get(r.id)?.answered ?? 0,
        followed: perRule.get(r.id)?.followed ?? 0,
      })),
      all: serializeSummary(stats.all),
      byTheBook: serializeSummary(stats.byTheBook),
      brokeARule: serializeSummary(stats.brokeARule),
      compliance: stats.compliance,
    };
  });
}

/** Active playbooks for a picker. */
export async function listPlaybookOptions(userId: string) {
  return prisma.playbook.findMany({
    where: { userId, isArchived: false },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}
