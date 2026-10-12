# Documentation index

Twelve documents, no index — until now. Start here.

`AGENTS.md` at the repo root carries the invariants that must not be violated;
this directory explains the reasoning behind them.

## Start here

| If you want to | Read |
|---|---|
| Know what the app is and how to run it | `../README.md`, then `../SETUP.md` |
| Understand the rules before changing code | `../AGENTS.md` |
| Know why a number is what it is | `METRICS.md` |
| Change anything touching sign-in or permissions | `AUTH.md` |

## By area

**Domain and data**

- `DATA-MODEL.md` — the schema, and the relationships that matter.
- `METRICS.md` — the metrics contract. Every judgement call is written down:
  what counts as a breakeven, how expectancy is built, why a deposit never
  sets a new high-water mark. Read this before "fixing" a statistic.
- `TRADES.md` — the trade lifecycle, and the derived columns the app owns.
- `PLAYBOOKS.md` — setups and their rules, per-trade checklists, and the
  by-the-book vs broke-a-rule comparison.
- `SIMULATE.md` — what-if replays, Monte Carlo on your R multiples, and the
  position-size calculator.
- `IMPORT.md` — MT4/MT5/CSV statement import: formats, broker time, the
  broker's profit as a conversion-rate source, re-imports and undo.
- `JOURNAL.md` — daily entries, moods, and the calendar view.
- `ANALYTICS.md` — the reports, and what each one is for.

**Security and identity**

- `AUTH.md` — the threat model (multi-user, hostile actors, open
  registration), the JWT-versus-database-sessions decision, rate limiting,
  roles, and a list of what is deliberately not built yet.

**Backtesting**

- `BACKTEST.md` — the feature, and the one design decision the rest follows
  from: a backtest's trades are real `Trade` rows, so `/analytics` works on
  them unchanged. Also who computes a run's trades, and the tripwire on that.
- `BACKTEST-DATA.md` — the candle pipeline: CSV formats, the mandatory
  timezone offset, upsert semantics, storage budgets and quotas.
- `BACKTEST-ENGINE.md` — the simulation contract: the fill model, indicator
  alignment (a shortened array is a look-ahead bug), and an honest account of
  what the strategy sandbox does and does not protect against.

**Interface**

- `DESIGN-SYSTEM.md` — tokens, and the tone the copy follows.
- `COMPONENTS.md` — one line per UI primitive, each saying when NOT to reach
  for it. Short on purpose; it is the densest document here.
- `PWA.md` — the service worker and offline behaviour.

**Working on it**

- `TESTING.md` — what is tested, what is not, and how to run each tier.

## A note on these documents

They are cross-referenced from code comments, and several of them record
decisions rather than descriptions — the reasoning in `METRICS.md` and
`BACKTEST-ENGINE.md` is the argument, not a summary of the code.

So: **if you change behaviour a document describes, update the document in the
same commit.** A doc that has become false is worse than no doc, because it is
believed. Two of the worst problems found in this repo's history were visible
only as a comment that no longer matched the code.
