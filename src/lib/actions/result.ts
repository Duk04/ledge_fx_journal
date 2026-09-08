import type { z } from "zod";

/**
 * The one shape every server action returns.
 *
 * WHY ACTIONS DO NOT THROW. A Server Action wired to a form's `action` prop
 * has no caller-side try/catch — a rejected promise there breaks the page
 * rather than showing a field error. So failures come back as values. (The
 * reasoning was written out at the top of `trades.ts`; this is that contract,
 * made shared.)
 *
 * WHY IT IS GENERIC. The type was declared TEN times across the action
 * modules: seven byte-identical `interface`s, one missing `fieldErrors`, one
 * a proper discriminated union, and one a different shape entirely. The
 * reason it kept being redeclared is that success payloads genuinely differ —
 * nothing from `deleteTag`, an `id` from `createTrade`, a `runId` from
 * `recordStrategyRun`, a `savedAt` from `saveJournalEntry`, an `updated`
 * count from `recomputeDerivedColumns`.
 *
 * Modelling that as an intersection (`ActionResult & { runId?: string }`,
 * which `backtests.ts` did) loses the discrimination: `runId` ends up
 * optional on the FAILURE arm too, so `result.runId` typechecks on a value
 * that cannot have one. A generic keeps the union intact — after
 * `if (!result.ok) return`, the payload is present and required.
 */

export interface ActionFailure {
  ok: false;
  /** Per-field messages keyed by form field name; consumed by RHF `setError`. */
  fieldErrors?: Record<string, string[]>;
  /** A single form-level message, for anything not attributable to one field. */
  formError?: string;
}

export type ActionResult<T = Record<never, never>> = ({ ok: true } & T) | ActionFailure;

export function ok(): ActionResult;
export function ok<T extends object>(data: T): ActionResult<T>;
export function ok(data: object = {}) {
  return { ok: true as const, ...data };
}

export function fail(formError: string): ActionFailure {
  return { ok: false, formError };
}

export function failFields(fieldErrors: Record<string, string[]>): ActionFailure {
  return { ok: false, fieldErrors };
}

/**
 * Flattens a ZodError to the `fieldErrors` shape.
 *
 * Keys on `issue.path[0]` only. Every action schema here is flat, and a
 * nested path would otherwise produce a key no form field is registered
 * under — the error would vanish from the UI rather than appear in the wrong
 * place, which is worse. Schema-level `.refine()` issues have an empty path
 * and land under `"form"`.
 *
 * This function was copy-pasted into seven action modules.
 */
export function fieldErrorsFrom(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/** Narrows to the failure arm, for callers that cannot narrow structurally. */
export function isFailure(result: { ok: boolean }): result is ActionFailure {
  return !result.ok;
}
