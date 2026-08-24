import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";

/**
 * Everything the signed-in user owns, as one JSON document. Deliberately
 * excludes anything not truly "theirs to export": the password hash, other
 * users' data, and shared reference tables (instruments) — see
 * docs/JOURNAL.md for the full "what's not included" list, which is also
 * shown next to the download button in Settings → Data.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireUser();

  const [profile, accounts, tags, journalEntries] = await Promise.all([
    prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, email: true, name: true, timezone: true, role: true, createdAt: true },
    }),
    prisma.tradingAccount.findMany({
      where: { userId: user.id },
      include: {
        balanceEvents: true,
        trades: {
          include: {
            tradeTags: { include: { tag: { select: { name: true, kind: true } } } },
            attachments: true,
          },
        },
      },
    }),
    prisma.tag.findMany({ where: { userId: user.id }, orderBy: [{ kind: "asc" }, { sortOrder: "asc" }] }),
    prisma.journalEntry.findMany({ where: { userId: user.id }, orderBy: { entryDate: "asc" } }),
  ]);

  const payload = {
    exportedAt: new Date().toISOString(),
    notIncluded: [
      "password hash",
      "other users' data",
      "the shared instrument reference table (see /settings → Instruments, or src/lib/instruments.ts for defaults)",
      "attachment file bytes — only their stored URL/storage key are included below",
    ],
    profile,
    accounts: accounts.map((a) => ({
      id: a.id,
      label: a.label,
      broker: a.broker,
      platform: a.platform,
      accountType: a.accountType,
      currency: a.currency,
      startingBalance: a.startingBalance.toString(),
      riskPerTradePct: a.riskPerTradePct?.toString() ?? null,
      isArchived: a.isArchived,
      createdAt: a.createdAt.toISOString(),
      balanceEvents: a.balanceEvents.map((e) => ({
        id: e.id,
        kind: e.kind,
        amount: e.amount.toString(),
        occurredAt: e.occurredAt.toISOString(),
        note: e.note,
      })),
      trades: a.trades.map((t) => ({
        id: t.id,
        symbol: t.symbol,
        direction: t.direction,
        status: t.status,
        openedAt: t.openedAt.toISOString(),
        closedAt: t.closedAt?.toISOString() ?? null,
        entryPrice: t.entryPrice.toString(),
        exitPrice: t.exitPrice?.toString() ?? null,
        stopLoss: t.stopLoss?.toString() ?? null,
        takeProfit: t.takeProfit?.toString() ?? null,
        volumeLots: t.volumeLots.toString(),
        commission: t.commission.toString(),
        swap: t.swap.toString(),
        conversionRate: t.conversionRate?.toString() ?? null,
        netPnl: t.netPnl?.toString() ?? null,
        grossPnl: t.grossPnl?.toString() ?? null,
        pips: t.pips?.toString() ?? null,
        rMultiple: t.rMultiple?.toString() ?? null,
        riskAmount: t.riskAmount?.toString() ?? null,
        holdingMinutes: t.holdingMinutes,
        marketSession: t.marketSession,
        followedPlan: t.followedPlan,
        emotion: t.emotion,
        confidence: t.confidence,
        notes: t.notes,
        externalTicket: t.externalTicket,
        tags: t.tradeTags.map((tt) => tt.tag.name),
        attachments: t.attachments.map((att) => ({
          id: att.id,
          kind: att.kind,
          storageKey: att.storageKey,
          externalUrl: att.externalUrl,
          mimeType: att.mimeType,
          caption: att.caption,
          createdAt: att.createdAt.toISOString(),
        })),
      })),
    })),
    tags: tags.map((t) => ({ id: t.id, name: t.name, kind: t.kind, color: t.color, sortOrder: t.sortOrder })),
    journalEntries: journalEntries.map((e) => ({
      date: e.entryDate.toISOString().slice(0, 10),
      preMarket: e.preMarket,
      review: e.review,
      mood: e.mood,
    })),
  };

  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="fx-journal-export-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
