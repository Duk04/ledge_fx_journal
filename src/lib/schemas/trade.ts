/**
 * Zod schema for the trade entry/edit form.
 *
 * This module is imported from BOTH sides of the boundary: the client form
 * (`trade-form.tsx`, for `zodResolver`) and the server actions (for
 * `parseTradeForm`, the authoritative check). It must therefore stay free of
 * `server-only` imports and database access — "does this symbol exist" is
 * answered by injecting a `validSymbols` list rather than querying Prisma
 * here, so the same schema works in a browser bundle.
 *
 * Every raw value on the wire (FormData entries, and RHF's default
 * string-valued inputs) is a string. `emptyToUndefined` + `z.coerce` is the
 * one pattern used throughout: an empty string means "the user left this
 * optional field blank", not "zero".
 */
import { z } from "zod";
import { validateTradeGeometry } from "@/lib/metrics";
import type { InstrumentSpec, TradeGeometryProblem } from "@/lib/metrics/types";

export const TRADE_DIRECTIONS = ["LONG", "SHORT"] as const;
export const TRADE_STATUSES = ["OPEN", "CLOSED", "CANCELLED"] as const;

/** Trade ids in this app are not guaranteed to be RFC uuid/cuid — the seed
 * data uses fixed slugs like "seed-tag-ob-retest" for reproducibility (see
 * prisma/seed.ts), and Prisma's `id` columns are plain `String`, not a
 * generated-format constraint. So tagIds are validated as "looks like an id"
 * (non-empty, url-safe) rather than a strict uuid/cuid pattern, which would
 * reject perfectly real rows from this app's own fixtures. */
const ID_LIKE = /^[a-zA-Z0-9_-]{1,64}$/;

function emptyToUndefined(value: unknown) {
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
}

/** An optional decimal field: "" -> undefined, otherwise a finite number. */
function optionalNumber(message = "Must be a number") {
  return z.preprocess(emptyToUndefined, z.coerce.number(message).finite(message).optional());
}

function optionalPositive(message = "Must be greater than 0") {
  return z.preprocess(emptyToUndefined, z.coerce.number().finite().positive(message).optional());
}

/**
 * Full trade form schema, parameterised by the set of symbols that are
 * actually allowed right now (i.e. `instruments.isActive`). Kept as a
 * factory rather than one static export so both the client (which knows the
 * instrument list from its own props) and the server (which just fetched it
 * from `listInstruments`) can get an existence check without this module
 * touching the database itself.
 */
export function buildTradeFormSchema(validSymbols?: ReadonlySet<string>) {
  return z
    .object({
      symbol: z.preprocess(
        (v) => (typeof v === "string" ? v.trim().toUpperCase() : v),
        z.string().min(1, "Symbol is required"),
      ),
      direction: z.enum(TRADE_DIRECTIONS, { error: "Direction is required" }),
      status: z.enum(TRADE_STATUSES, { error: "Status is required" }),

      openedAt: z.coerce.date({ error: "Open date/time is required" }),
      closedAt: z.preprocess(emptyToUndefined, z.coerce.date().optional()),

      entryPrice: z.preprocess(
        emptyToUndefined,
        z.coerce.number({ error: "Entry price is required" }).finite().positive("Entry price must be greater than 0"),
      ),
      exitPrice: optionalPositive("Exit price must be greater than 0"),
      stopLoss: optionalPositive("Stop loss must be greater than 0"),
      // Where the stop was at entry; R is measured from it. Blank = same as
      // the stop loss (lib/metrics/trade.ts, riskStop).
      initialStopLoss: optionalPositive("Initial stop must be greater than 0"),
      // Worst / best price while open (MAE / MFE) — lib/metrics/excursion.ts.
      maePrice: optionalPositive("Worst price must be greater than 0"),
      mfePrice: optionalPositive("Best price must be greater than 0"),
      takeProfit: optionalPositive("Take profit must be greater than 0"),

      volumeLots: z.preprocess(
        emptyToUndefined,
        z.coerce.number({ error: "Volume is required" }).finite().positive("Volume must be greater than 0"),
      ),

      // Broker costs. Positive = a charge; a rebate/credit is a negative
      // number (see computeNetPnl's doc) — so these are NOT constrained to
      // be positive, only finite.
      commission: optionalNumber("Commission must be a number"),
      swap: optionalNumber("Swap must be a number"),
      conversionRate: optionalPositive("Conversion rate must be greater than 0"),

      // Tri-state on the wire: the Segmented control posts "yes" | "no" | ""
      // (never touched) rather than a checkbox's on/off, because "unknown"
      // is a real, distinct answer for a trade logged after the fact.
      followedPlan: z.preprocess((v) => {
        if (v === "yes" || v === true) return true;
        if (v === "no" || v === false) return false;
        return undefined;
      }, z.boolean().optional()),

      emotion: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(5).optional()),
      confidence: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(5).optional()),

      notes: z.preprocess(emptyToUndefined, z.string().max(4000, "Notes must be 4000 characters or fewer").optional()),

      tagIds: z.array(z.string().regex(ID_LIKE, "Invalid tag id")).default([]),
      playbookId: z.preprocess(emptyToUndefined, z.string().regex(ID_LIKE, "Invalid playbook id").optional()),
    })
    .superRefine((val, ctx) => {
      if (validSymbols && val.symbol && !validSymbols.has(val.symbol)) {
        ctx.addIssue({
          code: "custom",
          path: ["symbol"],
          message: `Unknown symbol "${val.symbol}" — pick one from the instrument list.`,
        });
      }

      // The only two fields that become required conditionally: a CLOSED
      // trade needs to say when and at what price it closed. Everything
      // else optional stays optional regardless of status.
      if (val.status === "CLOSED") {
        if (val.exitPrice === undefined) {
          ctx.addIssue({ code: "custom", path: ["exitPrice"], message: "Exit price is required to close a trade." });
        }
        if (val.closedAt === undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["closedAt"],
            message: "Close date/time is required to close a trade.",
          });
        }
      }
    });
}

/** The schema with no symbol-existence check — used for typing / tests. */
export const tradeFormSchema = buildTradeFormSchema();

export type TradeFormValues = z.infer<typeof tradeFormSchema>;

export type TradeFormParseResult =
  | { ok: true; values: TradeFormValues; warnings: TradeGeometryProblem[] }
  | { ok: false; fieldErrors: Record<string, string[]> };

/**
 * The keys pulled straight off FormData with `.get()`. `tagIds` is handled
 * separately below since a form can post it multiple times (checkboxes /
 * a multi-select), which `.get()` would silently truncate to one value.
 */
const SCALAR_KEYS = [
  "symbol",
  "direction",
  "status",
  "openedAt",
  "closedAt",
  "entryPrice",
  "exitPrice",
  "stopLoss",
  "initialStopLoss",
  "maePrice",
  "mfePrice",
  "takeProfit",
  "volumeLots",
  "commission",
  "swap",
  "conversionRate",
  "followedPlan",
  "emotion",
  "confidence",
  "notes",
  "playbookId",
] as const;

/** A stand-in instrument used only to run geometry checks, which never read
 * pip size / contract size / currency — see validateTradeGeometry's body. */
const GEOMETRY_ONLY_INSTRUMENT: InstrumentSpec = {
  symbol: "",
  pipSize: "1",
  contractSize: "1",
  digits: 2,
  quoteCurrency: "USD",
  assetClass: "FX",
};

/**
 * Parses a submitted trade form. Hard validation failures come back as
 * `{ ok: false, fieldErrors }` — never thrown. On success, `warnings` carries
 * whatever `validateTradeGeometry` found (e.g. a stop on the wrong side of
 * entry). Those are surfaced to the user but never block the save: traders
 * legitimately record trades where the stop was moved mid-trade, entered
 * a partial fill, or are back-filling a broker statement with imperfect
 * data, and a hard block on "your history doesn't look like a clean plan"
 * would make the journal useless for exactly the trades worth reviewing
 * most. The UI's job is to make the warning visible, not to refuse the row.
 */
export function parseTradeForm(
  formData: FormData,
  opts: { validSymbols?: readonly string[] } = {},
): TradeFormParseResult {
  const raw: Record<string, unknown> = {};
  for (const key of SCALAR_KEYS) {
    const value = formData.get(key);
    if (value !== null) raw[key] = value;
  }
  raw.tagIds = formData.getAll("tagIds").map(String).filter(Boolean);

  const validSymbols = opts.validSymbols ? new Set(opts.validSymbols.map((s) => s.toUpperCase())) : undefined;
  const schema = buildTradeFormSchema(validSymbols);
  const result = schema.safeParse(raw);

  if (!result.success) {
    return { ok: false, fieldErrors: result.error.flatten().fieldErrors as Record<string, string[]> };
  }

  const warnings = validateTradeGeometry({
    instrument: GEOMETRY_ONLY_INSTRUMENT,
    direction: result.data.direction,
    entryPrice: result.data.entryPrice,
    exitPrice: result.data.exitPrice,
    stopLoss: result.data.stopLoss,
    takeProfit: result.data.takeProfit,
    volumeLots: result.data.volumeLots,
    openedAt: result.data.openedAt,
    closedAt: result.data.closedAt,
  });

  return { ok: true, values: result.data, warnings };
}

/** The small payload for the "Close trade" action — just the two fields the
 * common case needs, validated on its own rather than dragging in every
 * optional field of the full form. */
export const closeTradeSchema = z.object({
  exitPrice: z.coerce
    .number({ error: "Exit price is required" })
    .finite()
    .positive("Exit price must be greater than 0"),
  closedAt: z.coerce.date({ error: "Close date/time is required" }),
  /** Lots to close. Omitted = everything still open; fewer = a partial close,
   * after which the trade stays OPEN (lib/metrics/fills.ts). */
  volumeLots: z.preprocess(
    (v) => (v === "" || v === null ? undefined : v),
    z.coerce.number().finite().positive("Volume must be greater than 0").optional(),
  ),
});

export type CloseTradeValues = z.infer<typeof closeTradeSchema>;
