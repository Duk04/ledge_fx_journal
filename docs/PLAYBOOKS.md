# Playbooks

Owns: `src/lib/playbook-stats.ts` (pure), `src/lib/actions/playbooks.ts`,
`src/lib/queries/playbooks.ts`, `src/components/playbooks/`,
`src/components/trades/checklist-panel.tsx`, `/playbooks`.

A playbook is a setup you trade, written down: a name and the rules that
make a trade one of it ("H4 trend agrees", "retest of the Asian high",
"risk ≤ 1%"). A trade is linked to one (in the trade form, or on the trade
page), and its checklist records, rule by rule, whether it was followed.

## What it measures

Per playbook, over the active account's trades:

- **All trades** — the setup's plain results.
- **By the book** — trades where every rule was answered and every answer
  was "followed".
- **Broke a rule** — trades with at least one "broke".
- **Compliance** — followed answers / all answers, and per rule.

The comparison between the second and third rows is the point. If trades
that followed every rule don't do better than trades that broke one, the
rules are not the edge — and the page says so.

Unanswered is its own state, everywhere: "didn't record it" is not "didn't
follow it". A trade with unanswered rules and no "broke" is in neither group.

## Editing rules without losing history

Rules are matched by their text when a playbook is saved
(`diffRules`): a rule whose text is unchanged keeps its id, and so its past
answers; reordering is free; new text is a new rule; removed text is deleted
with its answers. Rewording a rule therefore makes it a different rule — the
honest reading, since past answers were to the old wording.

Changing a trade's playbook deletes its answers: they were answers to the
other playbook's rules.

## Ownership

Every playbook query is scoped by `userId`. A trade is reached through an
account the user owns; the playbook it is linked to, and any rule checked on
it, must belong to the same user (checked in the actions; db tests cover a
foreign playbook on create, on link and in a rule check).
