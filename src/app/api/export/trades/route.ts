import { cookies } from "next/headers";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { ACCOUNT_COOKIE } from "@/lib/active-account";

/**
 * Streams the active account's trades as CSV. See docs/JOURNAL.md for the
 * full column list and the reasoning behind the UTF-8 BOM.
 */
export const dynamic = "force-dynamic";

const COLUMNS = [
  "id",
  "symbol",
  "direction",
  "status",
  "openedAt",
  "closedAt",
  "entryMode",
  "entryPrice",
  "exitPrice",
  "stopLoss",
  "takeProfit",
  "plannedRR",
  "plannedRisk",
  "resultR",
  "volumeLots",
  "commission",
  "swap",
  "conversionRate",
  "netPnl",
  "grossPnl",
  "pips",
  "rMultiple",
  "riskAmount",
  "holdingMinutes",
  "marketSession",
  "followedPlan",
  "emotion",
  "confidence",
  "notes",
  "externalTicket",
  "tags",
] as const;

type Row = Record<(typeof COLUMNS)[number], string>;

/** RFC 4180 field quoting — wraps in quotes (doubling any embedded quotes) only when needed. */
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function toRow(t: {
  id: string;
  symbol: string;
  direction: string;
  status: string;
  openedAt: Date;
  closedAt: Date | null;
  entryMode: string;
  entryPrice: { toString(): string } | null;
  plannedRR: { toString(): string } | null;
  plannedRisk: { toString(): string } | null;
  resultR: { toString(): string } | null;
  exitPrice: { toString(): string } | null;
  stopLoss: { toString(): string } | null;
  takeProfit: { toString(): string } | null;
  volumeLots: { toString(): string } | null;
  commission: { toString(): string };
  swap: { toString(): string };
  conversionRate: { toString(): string } | null;
  netPnl: { toString(): string } | null;
  grossPnl: { toString(): string } | null;
  pips: { toString(): string } | null;
  rMultiple: { toString(): string } | null;
  riskAmount: { toString(): string } | null;
  holdingMinutes: number | null;
  marketSession: string | null;
  followedPlan: boolean | null;
  emotion: number | null;
  confidence: number | null;
  notes: string | null;
  externalTicket: string | null;
  tags: string;
}): Row {
  return {
    id: t.id,
    symbol: t.symbol,
    direction: t.direction,
    status: t.status,
    openedAt: t.openedAt.toISOString(),
    closedAt: t.closedAt ? t.closedAt.toISOString() : "",
    entryMode: t.entryMode,
    entryPrice: t.entryPrice ? t.entryPrice.toString() : "",
    exitPrice: t.exitPrice ? t.exitPrice.toString() : "",
    stopLoss: t.stopLoss ? t.stopLoss.toString() : "",
    takeProfit: t.takeProfit ? t.takeProfit.toString() : "",
    plannedRR: t.plannedRR ? t.plannedRR.toString() : "",
    plannedRisk: t.plannedRisk ? t.plannedRisk.toString() : "",
    resultR: t.resultR ? t.resultR.toString() : "",
    volumeLots: t.volumeLots ? t.volumeLots.toString() : "",
    commission: t.commission.toString(),
    swap: t.swap.toString(),
    conversionRate: t.conversionRate ? t.conversionRate.toString() : "",
    netPnl: t.netPnl ? t.netPnl.toString() : "",
    grossPnl: t.grossPnl ? t.grossPnl.toString() : "",
    pips: t.pips ? t.pips.toString() : "",
    rMultiple: t.rMultiple ? t.rMultiple.toString() : "",
    riskAmount: t.riskAmount ? t.riskAmount.toString() : "",
    holdingMinutes: t.holdingMinutes !== null ? String(t.holdingMinutes) : "",
    marketSession: t.marketSession ?? "",
    followedPlan: t.followedPlan === null ? "" : String(t.followedPlan),
    emotion: t.emotion !== null ? String(t.emotion) : "",
    confidence: t.confidence !== null ? String(t.confidence) : "",
    notes: t.notes ?? "",
    externalTicket: t.externalTicket ?? "",
    tags: t.tags,
  };
}

function serializeRow(row: Row): string {
  return COLUMNS.map((c) => csvField(row[c])).join(",") + "\r\n";
}

export async function GET() {
  const user = await requireUser();

  const jar = await cookies();
  const requested = jar.get(ACCOUNT_COOKIE)?.value;
  let accountId: string | null = null;
  if (requested) {
    const owned = await prisma.tradingAccount.findFirst({
      where: { id: requested, userId: user.id },
      select: { id: true },
    });
    if (owned) accountId = owned.id;
  }
  if (!accountId) {
    const fallback = await prisma.tradingAccount.findFirst({
      where: { userId: user.id, isArchived: false },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    accountId = fallback?.id ?? null;
  }

  const account = accountId
    ? await prisma.tradingAccount.findFirst({ where: { id: accountId, userId: user.id } })
    : null;

  const encoder = new TextEncoder();
  const PAGE_SIZE = 500;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Leading BOM so Excel (which sniffs encoding, not just declares it)
      // opens the file as UTF-8 instead of guessing Latin-1 and mangling
      // any non-ASCII characters in notes.
      controller.enqueue(encoder.encode("﻿" + COLUMNS.join(",") + "\r\n"));

      if (!account) {
        controller.close();
        return;
      }

      let cursor: string | undefined;
      for (;;) {
        const rows = await prisma.trade.findMany({
          where: { accountId: account.id },
          orderBy: { openedAt: "asc" },
          take: PAGE_SIZE,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
          include: { tradeTags: { include: { tag: true } } },
        });
        if (rows.length === 0) break;

        let chunk = "";
        for (const t of rows) {
          chunk += serializeRow(toRow({ ...t, tags: t.tradeTags.map((tt) => tt.tag.name).join(";") }));
        }
        controller.enqueue(encoder.encode(chunk));

        cursor = rows[rows.length - 1].id;
        if (rows.length < PAGE_SIZE) break;
      }

      controller.close();
    },
  });

  const filenameBase = account ? account.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase() : "trades";

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filenameBase || "trades"}.csv"`,
    },
  });
}
