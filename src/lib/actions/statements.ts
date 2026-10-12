"use server";

import { revalidatePath } from "next/cache";
import type { Instrument, MarketSession } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { accountOrFailure } from "./guard";
import { syncTradeFromFills, toFill } from "./fills-store";
import { aggregateFills } from "@/lib/metrics/fills";
import { fail, ok, type ActionResult } from "./result";
import {
  decodeStatement,
  parseStatement,
  planImport,
  type BrokerTimezone,
  type ImportPlan,
  type StatementSource,
} from "@/lib/statements";

/**
 * Broker statement import. docs/IMPORT.md is the overview; the parsing and
 * the per-row decisions are pure functions in src/lib/statements/, and this
 * module only gathers their inputs from the database and writes the result.
 *
 * One action, two modes, so the preview and the import can never disagree:
 * `mode=preview` runs everything and writes nothing; `mode=import` runs the
 * same plan and writes it. The file is uploaded both times rather than cached
 * between them — statements are small, and there is then no server-side
 * state to expire, leak between users, or go stale.
 */

const MAX_STATEMENT_BYTES = 10 * 1024 * 1024;

export interface PreviewRow {
  ticket: string;
  symbolRaw: string;
  symbol: string | null;
  status: "new" | "duplicate" | "close" | "unmapped";
  direction: "LONG" | "SHORT";
  openedAt: string;
  closedAt: string | null;
  volumeLots: string;
  netPnl: string | null;
  brokerProfit: string | null;
  /** Our gross disagrees with the broker's beyond tolerance. */
  mismatch: boolean;
  /** The conversion rate is a 1:1 guess. */
  needsAttention: boolean;
  /** The rate was implied from the broker's profit (a cross). */
  impliedRate: boolean;
}

export interface StatementReport {
  source: StatementSource;
  statementCurrency: string | null;
  accountCurrency: string;
  rows: PreviewRow[];
  counts: { new: number; close: number; duplicate: number; unmapped: number };
  balanceEvents: { new: number; duplicate: number };
  unmappedSymbols: string[];
  skipped: number;
  warnings: string[];
  /** Set once an import has actually been written. */
  importId?: string;
}

function readTimezone(formData: FormData): BrokerTimezone | null {
  const mode = String(formData.get("tzMode") ?? "ny-close");
  if (mode === "ny-close") return { mode };
  if (mode === "fixed") {
    const minutes = Number(formData.get("tzOffsetMinutes"));
    if (!Number.isInteger(minutes) || Math.abs(minutes) > 14 * 60) return null;
    return { mode, offsetMinutes: minutes };
  }
  return null;
}

/** Submitted mappings for unmatched symbols, keeping only ones that name a
 * real instrument. */
function readAliases(formData: FormData, instruments: ReadonlyMap<string, Instrument>): Map<string, string> {
  const out = new Map<string, string>();
  try {
    const raw = JSON.parse(String(formData.get("aliases") ?? "{}")) as Record<string, unknown>;
    for (const [broker, symbol] of Object.entries(raw)) {
      if (typeof symbol === "string" && instruments.has(symbol)) out.set(broker.trim().toUpperCase(), symbol);
    }
  } catch {
    // Malformed JSON is the same as no mappings: those symbols stay unmapped.
  }
  return out;
}

function toReport(
  plan: ImportPlan,
  parsed: { source: StatementSource; currency: string | null; skipped: number; warnings: string[] },
  accountCurrency: string,
): StatementReport {
  const rows: PreviewRow[] = plan.positions.map((p) => ({
    ticket: p.position.ticket,
    symbolRaw: p.position.symbolRaw,
    symbol: p.symbol,
    status: p.status,
    direction: p.position.direction,
    openedAt: new Date(p.position.openedAt).toISOString(),
    closedAt: p.position.closedAt === null ? null : new Date(p.position.closedAt).toISOString(),
    volumeLots: p.position.volumeLots,
    netPnl: (p.derived?.netPnl as string | null | undefined) ?? null,
    brokerProfit: p.position.brokerProfit,
    mismatch: p.reconciliation?.mismatch ?? false,
    needsAttention: p.reconciliation?.needsAttention ?? false,
    impliedRate: p.reconciliation?.source === "IMPLIED",
  }));
  const count = (s: PreviewRow["status"]) => rows.filter((r) => r.status === s).length;
  const warnings = [...parsed.warnings];
  if (parsed.currency && parsed.currency !== accountCurrency) {
    warnings.unshift(
      `This statement is in ${parsed.currency} but the account is in ${accountCurrency}. Broker profits will not match — import into an account with the statement's currency.`,
    );
  }
  return {
    source: parsed.source,
    statementCurrency: parsed.currency,
    accountCurrency,
    rows,
    counts: { new: count("new"), close: count("close"), duplicate: count("duplicate"), unmapped: count("unmapped") },
    balanceEvents: {
      new: plan.balanceEvents.filter((b) => b.status === "new").length,
      duplicate: plan.balanceEvents.filter((b) => b.status === "duplicate").length,
    },
    unmappedSymbols: plan.unmappedSymbols,
    skipped: parsed.skipped,
    warnings,
  };
}

type Derived = {
  grossPnl: string | null;
  netPnl: string | null;
  pips: string | null;
  rMultiple: string | null;
  riskAmount: string | null;
  holdingMinutes: number | null;
  marketSession: MarketSession | null;
};

export async function importStatement(accountId: string, formData: FormData): Promise<ActionResult<StatementReport>> {
  const user = await requireUser();
  const found = await accountOrFailure(accountId, "That trading account was not found.");
  if ("failure" in found) return found.failure;
  const account = found.account;

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("Choose a statement file to import.");
  if (file.size > MAX_STATEMENT_BYTES) return fail("That file is larger than 10MB — is it really a statement?");

  const tz = readTimezone(formData);
  if (!tz) return fail("Choose how the statement's times map to UTC.");

  const parsed = parseStatement(decodeStatement(new Uint8Array(await file.arrayBuffer())), tz);
  if (parsed.positions.length === 0 && parsed.balanceEvents.length === 0) {
    return fail(parsed.warnings[0] ?? "No trades were found in that file.");
  }

  const instrumentRows = await prisma.instrument.findMany({ where: { isActive: true } });
  const instruments = new Map(instrumentRows.map((i) => [i.symbol, i]));
  const submittedAliases = readAliases(formData, instruments);
  const savedAliases = await prisma.symbolAlias.findMany({ where: { userId: user.id } });
  const aliases = new Map([...savedAliases.map((a) => [a.brokerSymbol, a.symbol] as const), ...submittedAliases]);

  const tickets = parsed.positions.map((p) => p.ticket);
  const [existingTrades, existingCash] = await Promise.all([
    prisma.trade.findMany({
      where: { accountId: account.id, externalTicket: { in: tickets } },
      select: { id: true, externalTicket: true, status: true },
    }),
    prisma.balanceEvent.findMany({
      where: { accountId: account.id, externalTicket: { in: parsed.balanceEvents.map((e) => e.ticket) } },
      select: { externalTicket: true },
    }),
  ]);

  const plan = planImport(parsed, {
    accountCurrency: account.currency,
    instruments,
    aliases,
    existingTrades: new Map(existingTrades.map((t) => [t.externalTicket!, { id: t.id, status: t.status }])),
    existingBalanceTickets: new Set(existingCash.map((e) => e.externalTicket!)),
  });
  const report = toReport(plan, parsed, account.currency);

  if (String(formData.get("mode")) !== "import") return ok(report);

  const creates = plan.positions.filter((p) => p.status === "new");
  const closes = plan.positions.filter((p) => p.status === "close");
  const cash = plan.balanceEvents.filter((b) => b.status === "new");
  if (creates.length + closes.length + cash.length === 0)
    return fail("Nothing new to import — every row is already in this account.");

  const importRow = await prisma.$transaction(async (tx) => {
    for (const [brokerSymbol, symbol] of submittedAliases) {
      await tx.symbolAlias.upsert({
        where: { userId_brokerSymbol: { userId: user.id, brokerSymbol } },
        create: { userId: user.id, brokerSymbol, symbol },
        update: { symbol },
      });
    }

    const row = await tx.tradeImport.create({
      data: {
        userId: user.id,
        accountId: account.id,
        source: parsed.source,
        fileName: file.name || null,
        tzMode: tz.mode,
        tzOffsetMinutes: tz.mode === "fixed" ? tz.offsetMinutes : null,
        tradesCreated: creates.length,
        tradesSkipped: report.counts.unmapped + parsed.skipped,
        balanceEvents: cash.length,
      },
    });

    // One create per position rather than createMany: each needs its
    // executions, and createMany returns no ids to hang them on. Statements
    // are hundreds of rows, not hundreds of thousands.
    for (const { position: p, symbol, reconciliation, derived } of creates) {
      const created = await tx.trade.createMany({
        skipDuplicates: true,
        data: [
          {
            accountId: account.id,
            symbol: symbol!,
            direction: p.direction,
            status: p.closedAt === null ? "OPEN" : "CLOSED",
            openedAt: new Date(p.openedAt),
            closedAt: p.closedAt === null ? null : new Date(p.closedAt),
            entryPrice: p.entryPrice,
            exitPrice: p.exitPrice,
            stopLoss: p.stopLoss,
            initialStopLoss: p.stopLoss,
            takeProfit: p.takeProfit,
            volumeLots: p.volumeLots,
            commission: p.commission,
            swap: p.swap,
            conversionRate: reconciliation?.conversionRate ?? null,
            brokerProfit: p.brokerProfit,
            externalTicket: p.ticket,
            importId: row.id,
            ...(derived as unknown as Derived),
          },
        ],
      });
      // skipDuplicates: a concurrent import of the same ticket wins the race
      // and this row is silently skipped — so are its fills.
      if (created.count === 0) continue;
      const trade = await tx.trade.findUniqueOrThrow({
        where: { accountId_externalTicket: { accountId: account.id, externalTicket: p.ticket } },
        select: { id: true },
      });
      await tx.execution.createMany({
        data: p.fills.map((f) => ({
          tradeId: trade.id,
          kind: f.kind,
          executedAt: new Date(f.at),
          price: f.price,
          volumeLots: f.volumeLots,
        })),
      });
    }

    for (const { position: p, reconciliation, existingId } of closes) {
      // Broker facts first, then the exit as a fill for whatever is still
      // open, then re-derive everything from the fills.
      await tx.trade.update({
        where: { id: existingId!, accountId: account.id },
        data: {
          commission: p.commission,
          swap: p.swap,
          conversionRate: reconciliation?.conversionRate ?? null,
          brokerProfit: p.brokerProfit,
        },
      });
      const fills = await tx.execution.findMany({ where: { tradeId: existingId! } });
      const open = aggregateFills(fills.map(toFill));
      await tx.execution.create({
        data: {
          tradeId: existingId!,
          kind: "EXIT",
          executedAt: new Date(p.closedAt!),
          price: p.exitPrice!,
          volumeLots: open.volumeLots.minus(open.exitedLots).toString(),
        },
      });
      await syncTradeFromFills(tx, existingId!, account.currency);
    }

    if (cash.length) {
      await tx.balanceEvent.createMany({
        skipDuplicates: true,
        data: cash.map(({ event }) => ({
          accountId: account.id,
          kind: Number(event.amount) >= 0 ? "DEPOSIT" : "WITHDRAWAL",
          amount: event.amount,
          occurredAt: new Date(event.at),
          note: event.comment || null,
          externalTicket: event.ticket,
          importId: row.id,
        })),
      });
    }
    return row;
  });

  revalidatePath("/trades");
  revalidatePath("/");
  revalidatePath("/trades/import");
  return ok({ ...report, importId: importRow.id });
}

/**
 * Removes everything one import CREATED: its trades and cash movements, then
 * the import row. Positions an import merely closed are left as they are —
 * they existed before it, and "undo" must never delete a trade the user
 * logged or imported some other time.
 */
export async function undoImport(importId: string): Promise<ActionResult<{ trades: number; balanceEvents: number }>> {
  const user = await requireUser();
  const row = await prisma.tradeImport.findFirst({ where: { id: importId, userId: user.id } });
  if (!row) return fail("That import was not found.");

  const [trades, cash] = await prisma.$transaction([
    prisma.trade.deleteMany({ where: { importId: row.id, accountId: row.accountId } }),
    prisma.balanceEvent.deleteMany({ where: { importId: row.id, accountId: row.accountId } }),
    prisma.tradeImport.delete({ where: { id: row.id } }),
  ]);

  revalidatePath("/trades");
  revalidatePath("/");
  revalidatePath("/trades/import");
  return ok({ trades: trades.count, balanceEvents: cash.count });
}
