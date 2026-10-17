import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import {
  EXPORT_SCHEMA_VERSION,
  type ExportAccountWrite,
  type ExportFileWrite,
  type ExportTradeWrite,
} from "@/lib/export-schema";

/**
 * Everything the signed-in user owns, as one JSON document. Deliberately
 * excludes anything not truly "theirs to export": the password hash, other
 * users' data, and shared reference tables (instruments) — see
 * docs/JOURNAL.md for the full "what's not included" list, which is also
 * shown next to the download button in Settings → Data.
 *
 * The payload is typed by `src/lib/export-schema.ts`, the same schema
 * Settings → Data → Restore parses uploads with, so the writer and the reader
 * cannot drift apart without a compile error here.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireUser();

  const [profile, accounts, tags, journalEntries, playbooks, strategies, symbolAliases, notificationPrefs] =
    await Promise.all([
      prisma.user.findUnique({
        where: { id: user.id },
        select: { id: true, email: true, name: true, timezone: true, locale: true, role: true, createdAt: true },
      }),
      prisma.tradingAccount.findMany({
        where: { userId: user.id },
        include: {
          balanceEvents: true,
          trades: {
            include: {
              tradeTags: { include: { tag: { select: { name: true, kind: true } } } },
              attachments: true,
              executions: { orderBy: { executedAt: "asc" } },
              playbook: { select: { name: true } },
              ruleChecks: { include: { rule: { select: { text: true } } } },
            },
          },
        },
      }),
      prisma.tag.findMany({ where: { userId: user.id }, orderBy: [{ kind: "asc" }, { sortOrder: "asc" }] }),
      prisma.journalEntry.findMany({ where: { userId: user.id }, orderBy: { entryDate: "asc" } }),
      prisma.playbook.findMany({
        where: { userId: user.id },
        orderBy: { name: "asc" },
        include: { rules: { orderBy: { sortOrder: "asc" } } },
      }),
      prisma.strategy.findMany({ where: { userId: user.id }, orderBy: { name: "asc" } }),
      prisma.symbolAlias.findMany({ where: { userId: user.id }, orderBy: { brokerSymbol: "asc" } }),
      prisma.notificationPrefs.findUnique({ where: { userId: user.id } }),
    ]);

  const payload: ExportFileWrite = {
    // 2: trades carry `executions` and `initialStopLoss`. Version 1 had
    // neither; a reader of a v1 file should treat each trade as one entry
    // (and one exit if closed) at its own prices and times
    // (`normalizeExport` in lib/export-schema.ts does exactly that).
    //
    // Fields added since without a bump — challenge rules, MAE/MFE, tagRefs,
    // attachment dimensions, balance-event tickets, strategies, symbol
    // aliases, notification preferences — are purely additive, and the
    // schema reads them as optional so an earlier v2 file still restores.
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    notIncluded: [
      "password hash",
      "other users' data",
      "the shared instrument reference table (see /settings → Instruments, or src/lib/instruments.ts for defaults)",
      "attachment file bytes — only their stored URL/storage key are included below",
      "backtest runs — reproducible from a strategy (included below) and candles (shared reference data)",
      "statement/candle import history, notification send logs, sign-in attempts and sessions",
    ],
    profile: profile ? { ...profile, createdAt: profile.createdAt.toISOString() } : null,
    accounts: accounts.map((a): ExportAccountWrite => ({
      id: a.id,
      label: a.label,
      broker: a.broker,
      platform: a.platform,
      accountType: a.accountType,
      currency: a.currency,
      startingBalance: a.startingBalance.toString(),
      riskPerTradePct: a.riskPerTradePct?.toString() ?? null,
      dailyLossLimitPct: a.dailyLossLimitPct?.toString() ?? null,
      maxDrawdownPct: a.maxDrawdownPct?.toString() ?? null,
      drawdownMode: a.drawdownMode,
      profitTargetPct: a.profitTargetPct?.toString() ?? null,
      minTradingDays: a.minTradingDays,
      isArchived: a.isArchived,
      createdAt: a.createdAt.toISOString(),
      balanceEvents: a.balanceEvents.map((e) => ({
        id: e.id,
        kind: e.kind,
        amount: e.amount.toString(),
        occurredAt: e.occurredAt.toISOString(),
        note: e.note,
        externalTicket: e.externalTicket,
      })),
      trades: a.trades.map((t): ExportTradeWrite => ({
        id: t.id,
        symbol: t.symbol,
        direction: t.direction,
        status: t.status,
        openedAt: t.openedAt.toISOString(),
        closedAt: t.closedAt?.toISOString() ?? null,
        entryMode: t.entryMode,
        entryPrice: t.entryPrice?.toString() ?? null,
        plannedRR: t.plannedRR?.toString() ?? null,
        plannedRisk: t.plannedRisk?.toString() ?? null,
        resultR: t.resultR?.toString() ?? null,
        exitPrice: t.exitPrice?.toString() ?? null,
        stopLoss: t.stopLoss?.toString() ?? null,
        initialStopLoss: t.initialStopLoss?.toString() ?? null,
        maePrice: t.maePrice?.toString() ?? null,
        mfePrice: t.mfePrice?.toString() ?? null,
        takeProfit: t.takeProfit?.toString() ?? null,
        volumeLots: t.volumeLots?.toString() ?? null,
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
        brokerProfit: t.brokerProfit?.toString() ?? null,
        executions: t.executions.map((e) => ({
          kind: e.kind,
          executedAt: e.executedAt.toISOString(),
          price: e.price.toString(),
          volumeLots: e.volumeLots.toString(),
          externalDealId: e.externalDealId,
        })),
        tags: t.tradeTags.map((tt) => tt.tag.name),
        // A tag is unique by (kind, name), so a name alone is ambiguous.
        tagRefs: t.tradeTags.map((tt) => ({ name: tt.tag.name, kind: tt.tag.kind })),
        playbook: t.playbook?.name ?? null,
        ruleChecks: t.ruleChecks.map((c) => ({ rule: c.rule.text, followed: c.followed })),
        attachments: t.attachments.map((att) => ({
          id: att.id,
          kind: att.kind,
          storageKey: att.storageKey,
          externalUrl: att.externalUrl,
          mimeType: att.mimeType,
          width: att.width,
          height: att.height,
          sizeBytes: att.sizeBytes,
          caption: att.caption,
          createdAt: att.createdAt.toISOString(),
        })),
      })),
    })),
    tags: tags.map((t) => ({ id: t.id, name: t.name, kind: t.kind, color: t.color, sortOrder: t.sortOrder })),
    playbooks: playbooks.map((p) => ({
      name: p.name,
      description: p.description,
      isArchived: p.isArchived,
      rules: p.rules.map((r) => r.text),
    })),
    journalEntries: journalEntries.map((e) => ({
      date: e.entryDate.toISOString().slice(0, 10),
      preMarket: e.preMarket,
      review: e.review,
      mood: e.mood,
    })),
    // Strategy source is the user's own work and was missing from the export
    // until the restore feature asked "what would be lost?". Backtest RUNS
    // are not exported: they are reproducible from a strategy plus candles,
    // and candles are shared reference data.
    strategies: strategies.map((s) => ({
      name: s.name,
      description: s.description,
      code: s.code,
      params: s.params,
    })),
    symbolAliases: symbolAliases.map((a) => ({ brokerSymbol: a.brokerSymbol, symbol: a.symbol })),
    notificationPrefs: notificationPrefs
      ? {
          journalReminder: notificationPrefs.journalReminder,
          weeklySummary: notificationPrefs.weeklySummary,
          sendHour: notificationPrefs.sendHour,
          inAppReminder: notificationPrefs.inAppReminder,
        }
      : null,
  };

  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="fx-journal-export-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
