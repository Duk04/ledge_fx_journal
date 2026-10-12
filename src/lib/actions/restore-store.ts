import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma, type Instrument, type MarketSession, type TagKind } from "@prisma/client";
import { MAX_STRATEGY_CODE_CHARS } from "@/lib/backtest";
import { validateFills, type Fill } from "@/lib/metrics/fills";
import { derivedColumns, tradeInput } from "@/lib/trade-service";
import type { NormalizedExport, NormalizedTrade } from "@/lib/export-schema";
import { columnsFromFills } from "./fills-store";

/**
 * The write side of "restore from a JSON export" (actions/restore.ts is the
 * endpoint; docs/JOURNAL.md, "Restore", is the overview).
 *
 * Not a "use server" module, for the same reason fills-store.ts is not: this
 * takes a transaction client and a user id its caller has already
 * authenticated. Exported from an action module it would be a POST endpoint
 * that writes into whichever user id the request names.
 *
 * THE RULES, and why:
 *  - Accounts are ALWAYS created new, never merged. Merging needs a notion of
 *    "the same trade" across two journals, and the only candidate
 *    (externalTicket) is absent for every hand-entered trade. A duplicate
 *    account is easy to delete; a wrong merge is not easy to undo.
 *  - Derived columns are recomputed, never copied. The file's netPnl/pips/R
 *    are what an older formula, or a hand edit, said; trade-service is the
 *    only thing allowed to write them (trade-service.ts header).
 *  - Ids from the file are never reused. They belong to another user's rows
 *    (or another instance's), and a storage key would be worse: it points at
 *    another user's uploaded bytes, so restoring it would hand this user read
 *    access to them. Only https `externalUrl` attachments are restored.
 *  - Everything is written with set-based `createMany` and client-generated
 *    ids, a handful of statements per table however large the file. That is
 *    what lets one transaction hold the whole restore — so a failure, at any
 *    row, leaves nothing half-imported — without running past its timeout.
 */

type Tx = Prisma.TransactionClient;

/** Postgres caps a statement at 65,535 bind parameters; a trade row has ~35. */
const CHUNK = 1000;

async function insertChunked<T>(rows: T[], insert: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += CHUNK) await insert(rows.slice(i, i + CHUNK));
}

export interface RestoreSkipped {
  /** BACKTEST accounts: their runs and strategy settings are not in the
   * export, so the trades would belong to no run. */
  backtestAccounts: number;
  /** Trades on a symbol missing from the shared Instrument table. */
  unknownSymbolTrades: number;
  unknownSymbols: string[];
  /** Trades whose fills cannot describe a position (validateFills), or a
   * second trade with the same broker ticket in one account. */
  invalidTrades: number;
  /** Journal days this user had already written; theirs wins. */
  journalDays: number;
  /** Uploaded attachments: only a storage key travels, never the bytes. */
  uploadedAttachments: number;
  /** externalUrl attachments that are not https (addExternalLink's rule). */
  unsafeLinks: number;
  /** Checklist answers for a rule the reused playbook does not have. */
  ruleChecks: number;
  /** Strategies whose name this user already uses, or that are too long. */
  strategies: number;
  /** Symbol aliases already set, or for an unknown instrument. */
  symbolAliases: number;
}

export interface RestoreSummary {
  accounts: number;
  trades: number;
  executions: number;
  balanceEvents: number;
  journalEntries: number;
  tagsCreated: number;
  playbooksCreated: number;
  strategies: number;
  attachments: number;
  skipped: RestoreSkipped;
}

/** Same as trades.ts: derivedColumns() is typed for an update, whose Decimal
 * fields also accept `{ increment }` objects a create does not. It only ever
 * returns plain values. */
type PlainDerived = {
  grossPnl: string | null;
  netPnl: string | null;
  pips: string | null;
  rMultiple: string | null;
  riskAmount: string | null;
  holdingMinutes: number | null;
  marketSession: MarketSession | null;
};

const decOrNull = (v: string | null) => (v === null ? null : new Prisma.Decimal(v));

function isHttps(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

/** Strategy params as the strategy form writes them: a flat map of
 * primitives. Anything else is dropped to `{}` rather than stored, since the
 * workbench reads these as run-form defaults. */
function strategyParams(params: unknown): Prisma.InputJsonValue {
  if (typeof params !== "object" || params === null || Array.isArray(params)) return {};
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v;
  }
  return out;
}

/**
 * The columns a restored trade is written with: the descriptive fields from
 * the file, and the aggregate + derived ones produced by trade-service from
 * its fills — never read from the file. Returns null when the fills cannot
 * describe a position.
 */
function tradeColumns(t: NormalizedTrade, fills: Fill[], instrument: Instrument, accountCurrency: string) {
  const base = {
    direction: t.direction,
    entryPrice: new Prisma.Decimal(t.entryPrice),
    exitPrice: decOrNull(t.exitPrice),
    stopLoss: decOrNull(t.stopLoss),
    // Every write path falls back to the stop when no initial stop was given.
    initialStopLoss: decOrNull(t.initialStopLoss ?? t.stopLoss),
    takeProfit: decOrNull(t.takeProfit),
    volumeLots: new Prisma.Decimal(t.volumeLots),
    commission: new Prisma.Decimal(t.commission),
    swap: new Prisma.Decimal(t.swap),
    conversionRate: decOrNull(t.conversionRate),
    openedAt: t.openedAt,
    closedAt: t.closedAt,
  };
  if (t.status === "CANCELLED") {
    // Never filled: no executions, and the numbers come from the row itself,
    // as createTrade computes them for a cancelled trade.
    return {
      ...base,
      status: "CANCELLED" as const,
      ...(derivedColumns(tradeInput(base, instrument, accountCurrency)) as unknown as PlainDerived),
    };
  }
  if (validateFills(fills).length > 0) return null;
  const fromFills = columnsFromFills(base, fills, instrument, accountCurrency);
  return { ...base, ...(fromFills as unknown as typeof base & PlainDerived & { status: "OPEN" | "CLOSED" }) };
}

export async function restoreInto(
  tx: Tx,
  args: {
    userId: string;
    file: NormalizedExport;
    /** Shared reference rows for every symbol the file mentions. */
    instruments: ReadonlyMap<string, Instrument>;
    /** "EUR live" -> "EUR live (restored)", in the reader's language. */
    restoredLabel: (label: string) => string;
  },
): Promise<RestoreSummary> {
  const { userId, file, instruments } = args;
  const skipped: RestoreSkipped = {
    backtestAccounts: 0,
    unknownSymbolTrades: 0,
    unknownSymbols: [],
    invalidTrades: 0,
    journalDays: 0,
    uploadedAttachments: 0,
    unsafeLinks: 0,
    ruleChecks: 0,
    strategies: 0,
    symbolAliases: 0,
  };
  const unknownSymbols = new Set<string>();

  const accounts = file.accounts.filter((a) => {
    if (a.accountType !== "BACKTEST") return true;
    skipped.backtestAccounts++;
    return false;
  });

  // --- Tags: reuse (kind, name), else create ----------------------------------
  // A trade names its tags; `tagRefs` (kind + name) when the file has it, else
  // names alone, resolved against the file's own tag list for the kind.
  const fileTagKind = new Map<string, TagKind>();
  for (const tag of file.tags) if (!fileTagKind.has(tag.name)) fileTagKind.set(tag.name, tag.kind);
  const tradeTagRefs = (t: NormalizedTrade) =>
    t.tagRefs ?? t.tags.map((name) => ({ name, kind: fileTagKind.get(name) ?? ("CUSTOM" as const) }));
  const tagKey = (kind: string, name: string) => `${kind}\u0000${name}`;

  const wantedTags = new Map<string, { name: string; kind: TagKind; color: string | null; sortOrder: number | null }>();
  for (const tag of file.tags) wantedTags.set(tagKey(tag.kind, tag.name), tag);
  for (const a of accounts)
    for (const t of a.trades)
      for (const ref of tradeTagRefs(t)) {
        const key = tagKey(ref.kind, ref.name);
        if (!wantedTags.has(key)) wantedTags.set(key, { ...ref, color: null, sortOrder: null });
      }

  const existingTags = await tx.tag.findMany({ where: { userId }, select: { name: true, kind: true } });
  const existingTagKeys = new Set(existingTags.map((t) => tagKey(t.kind, t.name)));
  const newTags = [...wantedTags.entries()].filter(([key]) => !existingTagKeys.has(key)).map(([, t]) => t);
  // skipDuplicates: a tag created concurrently (another tab) is simply reused.
  const createdTags = await tx.tag.createMany({
    skipDuplicates: true,
    data: newTags.map((t) => ({
      userId,
      name: t.name,
      kind: t.kind,
      // An invalid colour falls back to the column default rather than
      // reaching a style attribute.
      ...(t.color && /^#[0-9a-fA-F]{6}$/.test(t.color) ? { color: t.color } : {}),
      sortOrder: t.sortOrder ?? 0,
    })),
  });
  const tagIds = new Map(
    (await tx.tag.findMany({ where: { userId }, select: { id: true, name: true, kind: true } })).map((t) => [
      tagKey(t.kind, t.name),
      t.id,
    ]),
  );

  // --- Playbooks: reuse by name, else create with their rules ----------------
  const filePlaybooks = new Map(file.playbooks.map((p) => [p.name, p]));
  for (const a of accounts)
    for (const t of a.trades)
      if (t.playbook && !filePlaybooks.has(t.playbook))
        filePlaybooks.set(t.playbook, { name: t.playbook, description: null, isArchived: false, rules: [] });

  const existingPlaybooks = new Set(
    (await tx.playbook.findMany({ where: { userId }, select: { name: true } })).map((p) => p.name),
  );
  const newPlaybooks = [...filePlaybooks.values()]
    .filter((p) => !existingPlaybooks.has(p.name))
    .map((p) => ({ ...p, id: randomUUID() }));
  await tx.playbook.createMany({
    data: newPlaybooks.map((p) => ({
      id: p.id,
      userId,
      name: p.name,
      description: p.description,
      isArchived: p.isArchived,
    })),
  });
  await tx.playbookRule.createMany({
    data: newPlaybooks.flatMap((p) =>
      [...new Set(p.rules)].map((text, sortOrder) => ({ playbookId: p.id, text, sortOrder })),
    ),
  });
  const playbookRows = await tx.playbook.findMany({
    where: { userId, name: { in: [...filePlaybooks.keys()] } },
    select: { id: true, name: true, rules: { select: { id: true, text: true } } },
  });
  const playbooks = new Map(
    playbookRows.map((p) => [p.name, { id: p.id, rules: new Map(p.rules.map((r) => [r.text, r.id])) }]),
  );

  // --- Accounts and everything under them -------------------------------------
  const summary: RestoreSummary = {
    accounts: 0,
    trades: 0,
    executions: 0,
    balanceEvents: 0,
    journalEntries: 0,
    tagsCreated: createdTags.count,
    playbooksCreated: newPlaybooks.length,
    strategies: 0,
    attachments: 0,
    skipped,
  };

  const accountRows: Prisma.TradingAccountCreateManyInput[] = [];
  const balanceRows: Prisma.BalanceEventCreateManyInput[] = [];
  const tradeRows: Prisma.TradeCreateManyInput[] = [];
  const executionRows: Prisma.ExecutionCreateManyInput[] = [];
  const tradeTagRows: Prisma.TradeTagCreateManyInput[] = [];
  const ruleCheckRows: Prisma.TradeRuleCheckCreateManyInput[] = [];
  const attachmentRows: Prisma.AttachmentCreateManyInput[] = [];

  for (const a of accounts) {
    const accountId = randomUUID();
    accountRows.push({
      id: accountId,
      userId,
      label: args.restoredLabel(a.label),
      broker: a.broker,
      platform: a.platform,
      accountType: a.accountType,
      currency: a.currency,
      startingBalance: a.startingBalance,
      riskPerTradePct: a.riskPerTradePct,
      dailyLossLimitPct: a.dailyLossLimitPct,
      maxDrawdownPct: a.maxDrawdownPct,
      drawdownMode: a.drawdownMode ?? "STATIC",
      profitTargetPct: a.profitTargetPct,
      minTradingDays: a.minTradingDays,
      isArchived: a.isArchived,
    });

    // (accountId, externalTicket) is unique; a repeated ticket in one file
    // account keeps its first row.
    const cashTickets = new Set<string>();
    for (const e of a.balanceEvents) {
      const ticket = e.externalTicket && !cashTickets.has(e.externalTicket) ? e.externalTicket : null;
      if (ticket) cashTickets.add(ticket);
      balanceRows.push({
        accountId,
        kind: e.kind,
        amount: e.amount,
        occurredAt: e.occurredAt,
        note: e.note,
        externalTicket: ticket,
      });
    }

    const tradeTickets = new Set<string>();
    for (const t of a.trades) {
      const instrument = instruments.get(t.symbol);
      if (!instrument) {
        skipped.unknownSymbolTrades++;
        unknownSymbols.add(t.symbol);
        continue;
      }
      if (t.externalTicket && tradeTickets.has(t.externalTicket)) {
        skipped.invalidTrades++;
        continue;
      }
      const fills: Fill[] = t.executions.map((e) => ({ ...e }));
      const columns = tradeColumns(t, fills, instrument, a.currency);
      if (!columns) {
        skipped.invalidTrades++;
        continue;
      }
      if (t.externalTicket) tradeTickets.add(t.externalTicket);

      const tradeId = randomUUID();
      const playbook = t.playbook ? playbooks.get(t.playbook) : undefined;
      tradeRows.push({
        id: tradeId,
        accountId,
        symbol: instrument.symbol,
        ...columns,
        maePrice: t.maePrice,
        mfePrice: t.mfePrice,
        followedPlan: t.followedPlan,
        emotion: t.emotion,
        confidence: t.confidence,
        notes: t.notes,
        externalTicket: t.externalTicket,
        brokerProfit: t.brokerProfit,
        playbookId: playbook?.id ?? null,
      });

      if (columns.status !== "CANCELLED") {
        const dealIds = new Set<string>();
        for (const e of t.executions) {
          const dealId = e.externalDealId && !dealIds.has(e.externalDealId) ? e.externalDealId : null;
          if (dealId) dealIds.add(dealId);
          executionRows.push({
            tradeId,
            kind: e.kind,
            executedAt: e.executedAt,
            price: e.price,
            volumeLots: e.volumeLots,
            externalDealId: dealId,
          });
        }
      }

      const tagIdsForTrade = new Set(
        tradeTagRefs(t)
          .map((ref) => tagIds.get(tagKey(ref.kind, ref.name)))
          .filter((id): id is string => Boolean(id)),
      );
      for (const tagId of tagIdsForTrade) tradeTagRows.push({ tradeId, tagId });

      const answered = new Set<string>();
      for (const check of t.ruleChecks) {
        const ruleId = playbook?.rules.get(check.rule);
        if (!ruleId) {
          skipped.ruleChecks++;
          continue;
        }
        if (answered.has(ruleId)) continue;
        answered.add(ruleId);
        ruleCheckRows.push({ tradeId, ruleId, followed: check.followed });
      }

      for (const att of t.attachments) {
        if (!att.externalUrl) {
          if (att.storageKey) skipped.uploadedAttachments++;
          continue;
        }
        if (!isHttps(att.externalUrl)) {
          skipped.unsafeLinks++;
          continue;
        }
        attachmentRows.push({
          tradeId,
          kind: att.kind,
          externalUrl: att.externalUrl,
          mimeType: att.mimeType,
          caption: att.caption,
          width: att.width,
          height: att.height,
          sizeBytes: att.sizeBytes,
        });
      }
    }
  }

  // Parents before children: accounts, then trades, then what hangs off them.
  await insertChunked(accountRows, (data) => tx.tradingAccount.createMany({ data }));
  await insertChunked(balanceRows, (data) => tx.balanceEvent.createMany({ data }));
  await insertChunked(tradeRows, (data) => tx.trade.createMany({ data }));
  await insertChunked(executionRows, (data) => tx.execution.createMany({ data }));
  await insertChunked(tradeTagRows, (data) => tx.tradeTag.createMany({ data }));
  await insertChunked(ruleCheckRows, (data) => tx.tradeRuleCheck.createMany({ data }));
  await insertChunked(attachmentRows, (data) => tx.attachment.createMany({ data }));
  summary.accounts = accountRows.length;
  summary.balanceEvents = balanceRows.length;
  summary.trades = tradeRows.length;
  summary.executions = executionRows.length;
  summary.attachments = attachmentRows.length;
  skipped.unknownSymbols = [...unknownSymbols].sort();

  // --- Journal: a day already written is the user's, and wins ---------------
  const entries = new Map(file.journalEntries.map((e) => [e.date, e]));
  skipped.journalDays += file.journalEntries.length - entries.size;
  const toEntryDate = (date: string) => new Date(`${date}T00:00:00.000Z`);
  const existingDays = new Set(
    (
      await tx.journalEntry.findMany({
        where: { userId, entryDate: { in: [...entries.keys()].map(toEntryDate) } },
        select: { entryDate: true },
      })
    ).map((e) => e.entryDate.toISOString().slice(0, 10)),
  );
  const newEntries = [...entries.values()].filter((e) => !existingDays.has(e.date));
  let journalCreated = 0;
  await insertChunked(newEntries, async (chunk) => {
    const res = await tx.journalEntry.createMany({
      skipDuplicates: true,
      data: chunk.map((e) => ({
        userId,
        entryDate: toEntryDate(e.date),
        preMarket: e.preMarket,
        review: e.review,
        mood: e.mood,
      })),
    });
    journalCreated += res.count;
  });
  summary.journalEntries = journalCreated;
  skipped.journalDays += entries.size - journalCreated;

  // --- Strategies: by name, never overwriting --------------------------------
  const strategies = file.strategies.filter((s) => s.code.trim() !== "" && s.code.length <= MAX_STRATEGY_CODE_CHARS);
  const strategiesCreated = await tx.strategy.createMany({
    skipDuplicates: true,
    data: strategies.map((s) => ({
      userId,
      name: s.name,
      description: s.description,
      code: s.code,
      params: strategyParams(s.params),
    })),
  });
  summary.strategies = strategiesCreated.count;
  skipped.strategies = file.strategies.length - strategiesCreated.count;

  // --- Symbol aliases: only where unset and the instrument exists ------------
  const aliases = file.symbolAliases
    .map((a) => ({ brokerSymbol: a.brokerSymbol.trim().toUpperCase(), symbol: a.symbol }))
    .filter((a) => instruments.has(a.symbol));
  const aliasesCreated = await tx.symbolAlias.createMany({
    skipDuplicates: true,
    data: aliases.map((a) => ({ userId, ...a })),
  });
  skipped.symbolAliases = file.symbolAliases.length - aliasesCreated.count;

  return summary;
}
