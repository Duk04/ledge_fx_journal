/**
 * The trade form's value shape, and the conversions between it and the two
 * things on either side: an ISO timestamp from the database, and the FormData
 * a server action receives.
 *
 * Extracted from `trade-form.tsx` for two reasons.
 *
 * It is ~80 lines of pure logic that had no tests, and it is where timezone
 * and missing-field bugs live: `datetime-local` inputs speak LOCAL wall time
 * with no offset, the database speaks UTC, and `buildFormData` decides which
 * blank fields are omitted entirely versus sent as empty strings. Every one of
 * those decisions is invisible until a number is wrong.
 *
 * And `trade-form.tsx` is a client component, so a server page importing
 * `isoToDatetimeLocal` from it (as the edit page did) pulled a "use client"
 * module into a server graph to get at a date helper.
 */

/** localStorage keys for the new-trade prefill. */
export const LAST_SYMBOL_KEY = "ledger.lastSymbol";
export const LAST_RISK_KEY = "ledger.lastRisk";

export interface TradeFormInput {
  /** Which form this is. New trades are R_MULTIPLE; an existing trade keeps
   * the mode it was recorded in (docs/TRADES.md). */
  entryMode: "PRICE" | "R_MULTIPLE";
  symbol: string;
  direction: "LONG" | "SHORT";
  status: "OPEN" | "CLOSED" | "CANCELLED";
  openedAt: string;
  closedAt: string;
  entryPrice: string;
  exitPrice: string;
  stopLoss: string;
  initialStopLoss: string;
  maePrice: string;
  mfePrice: string;
  takeProfit: string;
  volumeLots: string;
  /** R mode: money at risk, planned reward:risk, and the result in R. */
  plannedRisk: string;
  plannedRR: string;
  resultR: string;
  commission: string;
  swap: string;
  conversionRate: string;
  followedPlan: "" | "yes" | "no";
  emotion: string;
  confidence: string;
  notes: string;
  tagIds: string[];
  playbookId: string;
}

export function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Date -> "YYYY-MM-DDTHH:mm" in the *browser's* local time, for a
 * `datetime-local` input's value. */
export function toDatetimeLocal(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function isoToDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : toDatetimeLocal(d);
}

/** A `datetime-local` value is interpreted here (in the browser, in the
 * user's own timezone) and turned into an unambiguous UTC ISO string before
 * it ever reaches the server — the server has no way to know what timezone
 * a bare "2026-06-01T09:00" was meant in, and guessing wrong silently
 * misfiles a trade's session. */
export function datetimeLocalToIso(local: string): string {
  if (!local) return "";
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

/** True for a stored timestamp ("…Z" or "…+08:00"), false for a bare
 * datetime-local wall time ("2026-09-08T09:00"). */
function isOffsetTimestamp(value: string): boolean {
  return /(?:[zZ]|[+-]\d{2}:\d{2})$/.test(value);
}

/**
 * `openedAt` / `closedAt` in `defaults` may be either a datetime-local value or
 * a stored ISO timestamp. ISO timestamps are converted HERE, and this runs in
 * the browser: the edit page used to call `isoToDatetimeLocal` itself, which
 * runs on the server and so produced the server's wall time. On a UTC host an
 * Ulaanbaatar user then saw 01:30 for a 09:30 trade, and saving the form
 * unchanged wrote it back eight hours early, because `buildFormData` reads the
 * value in the browser's zone. Converting on the client keeps both directions
 * in one timezone. (The inputs are uncontrolled react-hook-form registrations,
 * so the server-rendered HTML carries no value for them and there is nothing
 * to mismatch on hydration.)
 */
export function defaultFormValues(defaults?: Partial<TradeFormInput>): TradeFormInput {
  const localised: Partial<TradeFormInput> = { ...defaults };
  if (localised.openedAt && isOffsetTimestamp(localised.openedAt)) {
    localised.openedAt = isoToDatetimeLocal(localised.openedAt);
  }
  if (localised.closedAt && isOffsetTimestamp(localised.closedAt)) {
    localised.closedAt = isoToDatetimeLocal(localised.closedAt);
  }
  return {
    entryMode: "R_MULTIPLE",
    symbol: "",
    direction: "LONG",
    status: "OPEN",
    openedAt: toDatetimeLocal(new Date()),
    closedAt: "",
    entryPrice: "",
    exitPrice: "",
    stopLoss: "",
    initialStopLoss: "",
    maePrice: "",
    mfePrice: "",
    takeProfit: "",
    volumeLots: "",
    plannedRisk: "",
    plannedRR: "",
    resultR: "",
    commission: "",
    swap: "",
    conversionRate: "",
    followedPlan: "",
    emotion: "",
    confidence: "",
    notes: "",
    tagIds: [],
    playbookId: "",
    ...localised,
  };
}

function filled(v: unknown): boolean {
  return v !== undefined && v !== null && String(v).trim() !== "";
}

export function buildFormData(values: TradeFormInput): FormData {
  const fd = new FormData();
  fd.set("symbol", values.symbol);
  fd.set("direction", values.direction);
  fd.set("status", values.status);
  fd.set("openedAt", datetimeLocalToIso(values.openedAt));
  if (values.closedAt) fd.set("closedAt", datetimeLocalToIso(values.closedAt));
  if (values.entryMode === "R_MULTIPLE") {
    // No prices at all; the result only once the trade is closed, so an
    // R typed and then switched back to OPEN is not half-saved.
    // `filled`, not truthiness: on submit these arrive as the resolver's
    // numbers, and a breakeven's 0R is falsy.
    fd.set("entryMode", "R_MULTIPLE");
    fd.set("plannedRisk", String(values.plannedRisk));
    if (filled(values.plannedRR)) fd.set("plannedRR", String(values.plannedRR));
    if (values.status === "CLOSED" && filled(values.resultR)) fd.set("resultR", String(values.resultR));
    if (filled(values.volumeLots)) fd.set("volumeLots", String(values.volumeLots));
  } else {
    fd.set("entryPrice", values.entryPrice);
    if (values.exitPrice) fd.set("exitPrice", values.exitPrice);
    if (values.stopLoss) fd.set("stopLoss", values.stopLoss);
    if (values.initialStopLoss) fd.set("initialStopLoss", values.initialStopLoss);
    if (values.maePrice) fd.set("maePrice", values.maePrice);
    if (values.mfePrice) fd.set("mfePrice", values.mfePrice);
    if (values.takeProfit) fd.set("takeProfit", values.takeProfit);
    fd.set("volumeLots", values.volumeLots);
  }
  if (values.commission) fd.set("commission", values.commission);
  if (values.swap) fd.set("swap", values.swap);
  if (values.conversionRate) fd.set("conversionRate", values.conversionRate);
  if (values.followedPlan) fd.set("followedPlan", values.followedPlan);
  if (values.emotion) fd.set("emotion", values.emotion);
  if (values.confidence) fd.set("confidence", values.confidence);
  if (values.notes) fd.set("notes", values.notes);
  values.tagIds.forEach((id) => fd.append("tagIds", id));
  if (values.playbookId) fd.set("playbookId", values.playbookId);
  return fd;
}

export type ROutcome = "WIN" | "LOSS" | "BREAKEVEN" | "CUSTOM";

/** Which outcome button a stored result corresponds to: a win at the planned
 * R:R, a full -1R loss, a scratch at 0, or anything else (a partial). */
export function outcomeFor(resultR: string, plannedRR: string): ROutcome | "" {
  if (resultR.trim() === "") return "";
  const r = Number(resultR);
  if (!Number.isFinite(r)) return "CUSTOM";
  if (r === -1) return "LOSS";
  if (r === 0) return "BREAKEVEN";
  if (plannedRR.trim() !== "" && r === Number(plannedRR)) return "WIN";
  return "CUSTOM";
}

/** The R an outcome button writes; undefined = leave the field to the user. */
export function resultForOutcome(outcome: ROutcome, plannedRR: string): string | undefined {
  if (outcome === "LOSS") return "-1";
  if (outcome === "BREAKEVEN") return "0";
  if (outcome === "WIN" && plannedRR.trim() !== "" && Number(plannedRR) > 0) return plannedRR.trim();
  return undefined;
}
