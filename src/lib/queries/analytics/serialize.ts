import "server-only";
import type { Summary } from "@/lib/metrics/types";
import { toNum } from "@/lib/decimal-bridge";

/**
 * Turning metrics-layer `Summary` objects (Decimal-valued) into the plain
 * DTOs a client component can receive. Every number that reaches the UI from
 * this layer passes through here.
 */

export interface SerializedSummary {
  tradeCount: number;
  closedCount: number;
  openCount: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRate: number | null;
  grossProfit: number;
  grossLoss: number;
  netPnl: number;
  profitFactor: number | null;
  averageWin: number | null;
  averageLoss: number | null;
  averageRMultiple: number | null;
  expectancyMoney: number | null;
  expectancyR: number | null;
  largestWin: number | null;
  largestLoss: number | null;
  payoffRatio: number | null;
  standardDeviationR: number | null;
  systemQuality: number | null;
  longestWinStreak: number;
  longestLossStreak: number;
  currentStreak: number;
  averageHoldingMinutes: number | null;
  breakevenWinRate: number | null;
}

export function serializeSummary(s: Summary): SerializedSummary {
  return {
    tradeCount: s.tradeCount,
    closedCount: s.closedCount,
    openCount: s.openCount,
    wins: s.wins,
    losses: s.losses,
    breakevens: s.breakevens,
    winRate: s.winRate,
    grossProfit: toNum(s.grossProfit) ?? 0,
    grossLoss: toNum(s.grossLoss) ?? 0,
    netPnl: toNum(s.netPnl) ?? 0,
    profitFactor: toNum(s.profitFactor),
    averageWin: toNum(s.averageWin),
    averageLoss: toNum(s.averageLoss),
    averageRMultiple: toNum(s.averageRMultiple),
    expectancyMoney: toNum(s.expectancyMoney),
    expectancyR: toNum(s.expectancyR),
    largestWin: toNum(s.largestWin),
    largestLoss: toNum(s.largestLoss),
    payoffRatio: toNum(s.payoffRatio),
    standardDeviationR: toNum(s.standardDeviationR),
    systemQuality: toNum(s.systemQuality),
    longestWinStreak: s.longestWinStreak,
    longestLossStreak: s.longestLossStreak,
    currentStreak: s.currentStreak,
    averageHoldingMinutes: s.averageHoldingMinutes,
    breakevenWinRate: s.breakevenWinRate,
  };
}

export interface BreakdownRow {
  key: string;
  label: string;
  count: number;
  netPnl: number;
  winRate: number | null;
  profitFactor: number | null;
  expectancyR: number | null;
  averageR: number | null;
  grossProfit: number;
  grossLoss: number;
}

export function toBreakdownRow(key: string, label: string, s: Summary): BreakdownRow {
  return {
    key,
    label,
    count: s.tradeCount,
    netPnl: toNum(s.netPnl) ?? 0,
    winRate: s.winRate,
    profitFactor: toNum(s.profitFactor),
    expectancyR: toNum(s.expectancyR),
    averageR: toNum(s.averageRMultiple),
    grossProfit: toNum(s.grossProfit) ?? 0,
    grossLoss: toNum(s.grossLoss) ?? 0,
  };
}

export const byNetPnlDesc = (a: BreakdownRow, b: BreakdownRow) => b.netPnl - a.netPnl;

export function mapGroup<K extends string | number>(
  map: Map<K, Summary>,
  labelFn: (k: K) => string,
  sort: (a: BreakdownRow, b: BreakdownRow) => number = byNetPnlDesc,
): BreakdownRow[] {
  return [...map.entries()].map(([k, s]) => toBreakdownRow(String(k), labelFn(k), s)).sort(sort);
}
