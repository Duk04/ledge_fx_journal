/**
 * Per-playbook performance and rule compliance — pure.
 *
 * The number a playbook exists to produce is the last one: how trades that
 * followed EVERY rule did, against trades that broke at least one. If the
 * first group isn't better, either the rules are wrong or they aren't the
 * edge you think they are — both worth knowing.
 *
 *  - compliance = followed checks / answered checks. Unanswered rules are
 *    left out of both: "didn't record it" is not "didn't follow it".
 *  - a trade is "by the book" when every rule of its playbook was answered
 *    and all were followed; "broke a rule" when any answer is no. A trade
 *    with unanswered rules and no "no" is in neither group.
 */
import { summarize } from "@/lib/metrics";
import type { Summary, TradeRow } from "@/lib/metrics/types";

export interface PlaybookTrade {
  row: TradeRow;
  checks: { ruleId: string; followed: boolean }[];
}

export interface PlaybookStats {
  all: Summary;
  byTheBook: Summary;
  brokeARule: Summary;
  /** null when no rule was ever answered. */
  compliance: number | null;
  /** Per rule: how often it was followed, of the times it was answered. */
  rules: { ruleId: string; answered: number; followed: number }[];
}

export function playbookStats(ruleIds: readonly string[], trades: readonly PlaybookTrade[]): PlaybookStats {
  const ruleSet = new Set(ruleIds);
  const perRule = new Map(ruleIds.map((id) => [id, { ruleId: id, answered: 0, followed: 0 }]));
  let answered = 0;
  let followed = 0;
  const byTheBook: TradeRow[] = [];
  const broke: TradeRow[] = [];

  for (const t of trades) {
    const relevant = t.checks.filter((c) => ruleSet.has(c.ruleId));
    for (const c of relevant) {
      answered++;
      const r = perRule.get(c.ruleId)!;
      r.answered++;
      if (c.followed) {
        followed++;
        r.followed++;
      }
    }
    if (relevant.some((c) => !c.followed)) broke.push(t.row);
    else if (ruleIds.length > 0 && relevant.length === ruleIds.length) byTheBook.push(t.row);
  }

  return {
    all: summarize(trades.map((t) => t.row)),
    byTheBook: summarize(byTheBook),
    brokeARule: summarize(broke),
    compliance: answered ? followed / answered : null,
    rules: [...perRule.values()],
  };
}

/**
 * Rule edits that keep history attached: a rule whose text is unchanged keeps
 * its id (and so its past checks); new text is a new rule; removed text is
 * deleted. Matching is by trimmed text — reordering is free, rewording a rule
 * makes it a different rule, which is the honest reading of a reworded rule.
 */
export function diffRules(
  existing: readonly { id: string; text: string }[],
  next: readonly string[],
): { keep: { id: string; sortOrder: number }[]; create: { text: string; sortOrder: number }[]; remove: string[] } {
  const pool = new Map<string, string[]>();
  for (const r of existing) {
    const key = r.text.trim();
    pool.set(key, [...(pool.get(key) ?? []), r.id]);
  }
  const keep: { id: string; sortOrder: number }[] = [];
  const create: { text: string; sortOrder: number }[] = [];
  next
    .map((t) => t.trim())
    .filter(Boolean)
    .forEach((text, sortOrder) => {
      const ids = pool.get(text);
      if (ids?.length) keep.push({ id: ids.shift()!, sortOrder });
      else create.push({ text, sortOrder });
    });
  const kept = new Set(keep.map((k) => k.id));
  return { keep, create, remove: existing.filter((r) => !kept.has(r.id)).map((r) => r.id) };
}
