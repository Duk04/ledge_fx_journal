/**
 * The JSON export file (`GET /api/export/data`), as a schema both sides share.
 *
 * WHY ONE SCHEMA FOR WRITER AND READER. The export route builds its payload as
 * a value typed by `z.input<typeof exportV2Schema>`, and the restore action
 * (src/lib/actions/restore.ts) parses uploads with the same schemas. A column
 * added to the writer and forgotten here is a tsc error in the route, not a
 * restore that silently drops it — which is exactly how challenge rules and
 * MAE/MFE went missing from the export before this file existed.
 *
 * WHAT IS STRICT AND WHAT IS NOT.
 *  - Core fields a restore cannot do without (a trade's symbol, side, status,
 *    open time, entry price, size; an account's platform and currency) are
 *    required and type-checked.
 *  - Fields added to version 2 after it shipped (challenge rules, MAE/MFE,
 *    tag kinds, strategies, ...) are optional, so a v2 file written before
 *    them still restores.
 *  - Unknown keys are accepted and dropped (zod's default object behaviour),
 *    so a file from a newer build that only ADDS fields still restores. A
 *    newer `schemaVersion` is refused, because a version bump means a field
 *    changed meaning, and guessing would import wrong numbers.
 *  - The derived columns (netPnl, pips, rMultiple, ...) are accepted but
 *    informational: restore recomputes them through trade-service and never
 *    reads these. A hand-edited netPnl must not become the journal's truth.
 *
 * Pure zod, no `server-only`: the unit tests import it, and nothing here
 * touches the database.
 */
import { z } from "zod";
import { simpleFills } from "@/lib/metrics/fills";

export const EXPORT_SCHEMA_VERSION = 2;

const PLATFORMS = ["MT5", "MT4", "CTRADER", "OTHER"] as const;
const ACCOUNT_TYPES = ["DEMO", "LIVE", "PROP", "BACKTEST"] as const;
const DIRECTIONS = ["LONG", "SHORT"] as const;
const STATUSES = ["OPEN", "CLOSED", "CANCELLED"] as const;
const SESSIONS = ["SYDNEY", "TOKYO", "LONDON", "NEW_YORK", "OVERLAP", "OFFHOURS"] as const;
const TAG_KINDS = ["SETUP", "MISTAKE", "SESSION", "CUSTOM"] as const;
const ATTACHMENT_KINDS = ["BEFORE", "AFTER", "OTHER"] as const;
const BALANCE_KINDS = ["DEPOSIT", "WITHDRAWAL", "ADJUSTMENT"] as const;
const EXECUTION_KINDS = ["ENTRY", "EXIT"] as const;

// Decimals travel as strings (Prisma `Decimal.toString()`), which can be
// exponent notation for very small values ("1.2e-7"). A bare number is
// accepted too, for a hand-edited file, and normalised to a string so nothing
// downstream ever sees a float.
const DECIMAL = /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
const dec = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .pipe(z.string().regex(DECIMAL, "expected a decimal number"));

const instant = z.iso.datetime({ offset: true }).transform((s) => new Date(s));

/** Optional on the wire (absent or null), always `T | null` once parsed. */
function opt<T extends z.ZodType>(schema: T) {
  return schema.nullish().transform((v) => v ?? null);
}

const rating = z.number().int().min(1).max(5);

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

const executionSchema = z.object({
  kind: z.enum(EXECUTION_KINDS),
  executedAt: instant,
  price: dec,
  volumeLots: dec,
  externalDealId: opt(z.string()),
});

const attachmentSchema = z.object({
  id: z.string().optional(),
  kind: z.enum(ATTACHMENT_KINDS).default("OTHER"),
  storageKey: opt(z.string()),
  externalUrl: opt(z.string()),
  mimeType: opt(z.string()),
  caption: opt(z.string()),
  width: opt(z.number().int()),
  height: opt(z.number().int()),
  sizeBytes: opt(z.number().int()),
  createdAt: z.string().optional(),
});

const ruleCheckSchema = z.object({ rule: z.string(), followed: z.boolean() });
const tagRefSchema = z.object({ name: z.string().min(1), kind: z.enum(TAG_KINDS) });

/** Fields a trade has had since version 1. */
const tradeCore = {
  id: z.string().optional(),
  symbol: z.string().min(1),
  direction: z.enum(DIRECTIONS),
  status: z.enum(STATUSES),
  openedAt: instant,
  closedAt: opt(instant),
  entryPrice: dec,
  exitPrice: opt(dec),
  stopLoss: opt(dec),
  takeProfit: opt(dec),
  volumeLots: dec,
  commission: dec.default("0"),
  swap: dec.default("0"),
  conversionRate: opt(dec),
  // Informational only — see the header. Restore recomputes every one.
  netPnl: dec.nullish(),
  grossPnl: dec.nullish(),
  pips: dec.nullish(),
  rMultiple: dec.nullish(),
  riskAmount: dec.nullish(),
  holdingMinutes: z.number().int().nullish(),
  marketSession: z.enum(SESSIONS).nullish(),
  followedPlan: opt(z.boolean()),
  emotion: opt(rating),
  confidence: opt(rating),
  notes: opt(z.string()),
  externalTicket: opt(z.string()),
  brokerProfit: opt(dec),
  /** Tag names. Ambiguous when one name exists under two kinds, which is why
   * `tagRefs` was added; kept so older readers keep working. */
  tags: z.array(z.string()).default([]),
  playbook: opt(z.string()),
  ruleChecks: z.array(ruleCheckSchema).default([]),
  attachments: z.array(attachmentSchema).default([]),
};

const tradeV1Schema = z.object(tradeCore);

const tradeV2Schema = z.object({
  ...tradeCore,
  // What makes a file version 2: fills, and the stop R is measured from.
  executions: z.array(executionSchema),
  initialStopLoss: opt(dec),
  // Added to v2 later; optional so an earlier v2 file still restores.
  maePrice: opt(dec),
  mfePrice: opt(dec),
  tagRefs: z.array(tagRefSchema).optional(),
});

const balanceEventSchema = z.object({
  id: z.string().optional(),
  kind: z.enum(BALANCE_KINDS),
  amount: dec,
  occurredAt: instant,
  note: opt(z.string()),
  externalTicket: opt(z.string()),
});

const percent = dec.refine((v) => Number(v) >= 0 && Number(v) <= 1000, "expected a percentage");

const accountCore = {
  id: z.string().optional(),
  label: z.string().trim().min(1),
  broker: opt(z.string()),
  platform: z.enum(PLATFORMS),
  accountType: z.enum(ACCOUNT_TYPES),
  currency: z.string().regex(/^[A-Z]{3}$/, "expected a 3-letter currency code"),
  startingBalance: dec,
  riskPerTradePct: opt(percent),
  // Prop-firm challenge rules: added to v2 later, optional for that reason.
  dailyLossLimitPct: opt(percent),
  maxDrawdownPct: opt(percent),
  drawdownMode: z.enum(["STATIC", "TRAILING"]).nullish(),
  profitTargetPct: opt(percent),
  minTradingDays: opt(z.number().int().min(0).max(365)),
  isArchived: z.boolean().default(false),
  createdAt: z.string().optional(),
  balanceEvents: z.array(balanceEventSchema).default([]),
};

const accountV1Schema = z.object({ ...accountCore, trades: z.array(tradeV1Schema).default([]) });
const accountV2Schema = z.object({ ...accountCore, trades: z.array(tradeV2Schema).default([]) });

const tagSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1),
  kind: z.enum(TAG_KINDS),
  color: opt(z.string()),
  sortOrder: opt(z.number().int()),
});

const playbookSchema = z.object({
  name: z.string().trim().min(1),
  description: opt(z.string()),
  isArchived: z.boolean().default(false),
  rules: z.array(z.string()).default([]),
});

const journalEntrySchema = z.object({
  date: z.iso.date(),
  preMarket: opt(z.string()),
  review: opt(z.string()),
  mood: opt(rating),
});

const strategySchema = z.object({
  name: z.string().trim().min(1),
  description: opt(z.string()),
  code: z.string(),
  // Whatever JSON the strategy stored. Typed loosely so the writer can pass
  // Prisma's JsonValue straight through; restore keeps it only when it is
  // the flat name -> number|string|boolean map the strategy form produces.
  params: z.unknown().optional(),
});

const symbolAliasSchema = z.object({ brokerSymbol: z.string().min(1), symbol: z.string().min(1) });

const profileSchema = z.object({
  id: z.string().optional(),
  email: z.string().optional(),
  name: z.string().nullish(),
  timezone: z.string().optional(),
  locale: z.string().optional(),
  role: z.string().optional(),
  createdAt: z.string().optional(),
});

const notificationPrefsSchema = z.object({
  journalReminder: z.boolean(),
  weeklySummary: z.boolean(),
  sendHour: z.number().int(),
  inAppReminder: z.boolean(),
});

const fileCore = {
  exportedAt: z.string().optional(),
  notIncluded: z.array(z.string()).optional(),
  profile: profileSchema.nullish(),
  tags: z.array(tagSchema).default([]),
  playbooks: z.array(playbookSchema).default([]),
  journalEntries: z.array(journalEntrySchema).default([]),
};

export const exportV1Schema = z.object({
  ...fileCore,
  schemaVersion: z.literal(1),
  accounts: z.array(accountV1Schema),
});

export const exportV2Schema = z.object({
  ...fileCore,
  schemaVersion: z.literal(2),
  accounts: z.array(accountV2Schema),
  // Added to v2 later; see the export route for why each is user data.
  strategies: z.array(strategySchema).default([]),
  symbolAliases: z.array(symbolAliasSchema).default([]),
  notificationPrefs: notificationPrefsSchema.nullish(),
});

export const exportFileSchema = z.discriminatedUnion("schemaVersion", [exportV1Schema, exportV2Schema]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** What the export route writes. Typed against the schema's INPUT so a field
 * the route forgets (or invents) is a compile error there. */
export type ExportFileWrite = z.input<typeof exportV2Schema>;
export type ExportAccountWrite = z.input<typeof accountV2Schema>;
export type ExportTradeWrite = z.input<typeof tradeV2Schema>;

/** A parsed file of either version, before normalising. */
export type ExportFile = z.output<typeof exportFileSchema>;
/** Every file, once normalised: the version-2 shape with defaults applied. */
export type NormalizedExport = z.output<typeof exportV2Schema>;
export type NormalizedAccount = z.output<typeof accountV2Schema>;
export type NormalizedTrade = z.output<typeof tradeV2Schema>;
export type NormalizedExecution = z.output<typeof executionSchema>;

// ---------------------------------------------------------------------------
// Version 1 -> version 2
// ---------------------------------------------------------------------------

/**
 * The fills a version-1 trade stands for: one ENTRY at its entry price, time
 * and size, and one EXIT at its exit if it is CLOSED. A CANCELLED trade never
 * filled and gets none. Same rule as `simpleExecutionsCreate` in
 * actions/fills-store.ts (which is server-only, hence `simpleFills` here).
 */
export function synthesizeExecutions(
  trade: Pick<NormalizedTrade, "status" | "openedAt" | "entryPrice" | "volumeLots" | "closedAt" | "exitPrice">,
): NormalizedExecution[] {
  if (trade.status === "CANCELLED") return [];
  return simpleFills({ ...trade, closedAt: trade.status === "CLOSED" ? trade.closedAt : null }).map((f) => ({
    kind: f.kind,
    executedAt: f.executedAt,
    price: String(f.price),
    volumeLots: String(f.volumeLots),
    externalDealId: null,
  }));
}

/** Lift a parsed file of any version to the version-2 shape. */
export function normalizeExport(file: ExportFile): NormalizedExport {
  if (file.schemaVersion === 2) return file;
  return {
    ...file,
    schemaVersion: 2,
    strategies: [],
    symbolAliases: [],
    notificationPrefs: null,
    accounts: file.accounts.map((a) => ({
      ...a,
      trades: a.trades.map((t) => ({
        ...t,
        // Version 1 had no separate initial stop; the stop on file is the
        // best reading of it, and what every write path falls back to.
        initialStopLoss: t.stopLoss,
        maePrice: null,
        mfePrice: null,
        executions: synthesizeExecutions(t),
      })),
    })),
  };
}

// ---------------------------------------------------------------------------
// Parsing an upload
// ---------------------------------------------------------------------------

export type ParseExportResult =
  | { ok: true; data: NormalizedExport; schemaVersion: 1 | 2 }
  | { ok: false; reason: "notAnExport" | "newerVersion" | "invalid"; issues: string[] };

/** `["accounts", 0, "trades", 3, "entryPrice"]` -> `accounts[0].trades[3].entryPrice`. */
export function formatIssuePath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((acc, key) => {
    if (typeof key === "number") return `${acc}[${key}]`;
    return acc ? `${acc}.${String(key)}` : String(key);
  }, "");
}

/**
 * Validate an already-JSON-parsed upload. Distinguishes "not an export at
 * all" and "an export from a newer build" from "an export with a bad field",
 * because the person reading the error needs a different next step for each.
 */
export function parseExportFile(json: unknown): ParseExportResult {
  if (typeof json !== "object" || json === null || Array.isArray(json) || !("schemaVersion" in json)) {
    return { ok: false, reason: "notAnExport", issues: [] };
  }
  const version = (json as { schemaVersion: unknown }).schemaVersion;
  if (typeof version !== "number") return { ok: false, reason: "notAnExport", issues: [] };
  if (version > EXPORT_SCHEMA_VERSION) return { ok: false, reason: "newerVersion", issues: [] };

  const parsed = exportFileSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid",
      issues: parsed.error.issues.map((i) => `${formatIssuePath(i.path) || "(root)"}: ${i.message}`),
    };
  }
  return { ok: true, data: normalizeExport(parsed.data), schemaVersion: parsed.data.schemaVersion };
}
