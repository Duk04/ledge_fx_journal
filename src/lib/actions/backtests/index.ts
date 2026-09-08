/**
 * Backtest run actions, split by kind:
 *
 *   ./replay    manual bar-by-bar replay
 *   ./strategy  coded strategy runs
 *   ./runs      deleting a run
 *   ./shared    constants, schemas and sync helpers both need
 *
 * Re-exported here so every importing component keeps its
 * `@/lib/actions/backtests` path.
 *
 * THIS FILE MUST NOT CARRY `"use server"`. Turbopack rejects a re-export
 * from such a module — "Only async functions are allowed to be exported in a
 * 'use server' file" — because it cannot statically prove that
 * `export { x } from "./y"` names an async function. The directive belongs on
 * the modules that DEFINE the actions, which is where it is; a barrel that
 * only forwards needs none, and the actions stay server actions either way.
 */
export { createReplayRun, recordReplayTrade } from "./replay";
export type { CreateReplayInput } from "./replay";
export { recordStrategyRun } from "./strategy";
export type { RecordStrategyRunInput } from "./strategy";
export { deleteRun } from "./runs";
