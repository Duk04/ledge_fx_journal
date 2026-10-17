"use client";

/**
 * The live preview strip under the form: computed P&L, pips, R multiple and
 * any geometry warnings, recomputed as the user types.
 *
 * Its own file because it is a self-contained read of the form's current
 * values — already separated by a divider comment in the original — and
 * because `trade-form.tsx` was 685 lines.
 */
import { useTranslations } from "next-intl";
import { computeRTrade, computeTrade, validateTradeGeometry } from "@/lib/metrics";
import { formatMoney, formatPips } from "@/lib/metrics/formatters";
import type { AssetClass } from "@/lib/metrics/types";
import { Stat } from "@/components/ui/stat";
import { Panel, PanelBody } from "@/components/ui/panel";
import type { InstrumentOption } from "@/lib/queries/trades";
import type { TradeFormInput } from "./trade-form-values";

export interface Preview {
  /** R mode shows the result in R where price mode shows pips. */
  mode: "PRICE" | "R_MULTIPLE";
  pips: string;
  riskAmount: string;
  plannedRR: string;
  netPnl: string;
  netPnlIsProjection: boolean;
}

export function buildPreview(
  values: Partial<TradeFormInput>,
  instrument: InstrumentOption | undefined,
  currency: string,
): Preview | null {
  if (!instrument || !values.direction) return null;
  const entry = Number(values.entryPrice);
  const volume = Number(values.volumeLots);
  if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(volume) || volume <= 0) return null;
  const openedAt = values.openedAt ? new Date(values.openedAt) : null;
  if (!openedAt || Number.isNaN(openedAt.getTime())) return null;

  const spec = {
    symbol: instrument.symbol,
    pipSize: instrument.pipSize,
    contractSize: instrument.contractSize,
    digits: instrument.digits,
    quoteCurrency: instrument.quoteCurrency,
    assetClass: instrument.assetClass as AssetClass,
  };

  const stopLoss = values.stopLoss ? Number(values.stopLoss) : undefined;
  const takeProfit = values.takeProfit ? Number(values.takeProfit) : undefined;
  const closedAt = values.closedAt ? new Date(values.closedAt) : undefined;
  const commission = values.commission ? Number(values.commission) : 0;
  const swap = values.swap ? Number(values.swap) : 0;
  const conversionRate = values.conversionRate ? Number(values.conversionRate) : undefined;

  // riskAmount / plannedRR never need an exit price — compute them
  // regardless of whether one has been entered yet.
  let base;
  try {
    base = computeTrade({
      instrument: spec,
      direction: values.direction,
      entryPrice: entry,
      stopLoss,
      takeProfit,
      volumeLots: volume,
      commission,
      swap,
      conversionRate,
      openedAt,
      closedAt,
    });
  } catch {
    return null;
  }

  // netPnl/pips DO need an exit — use the real exit price if the trader has
  // entered one, otherwise fall back to the take-profit as a "what if this
  // hits target" projection, which is the number worth seeing before a
  // trade has even closed.
  const exitPrice = values.exitPrice ? Number(values.exitPrice) : takeProfit;
  const netPnlIsProjection = !values.exitPrice && !!takeProfit;
  let atExit = base;
  if (exitPrice !== undefined) {
    try {
      atExit = computeTrade({
        instrument: spec,
        direction: values.direction,
        entryPrice: entry,
        exitPrice,
        stopLoss,
        takeProfit,
        volumeLots: volume,
        commission,
        swap,
        conversionRate,
        openedAt,
        closedAt,
      });
    } catch {
      atExit = base;
    }
  }

  return {
    mode: "PRICE",
    pips: formatPips(atExit.pips),
    riskAmount: base.riskAmount ? formatMoney(base.riskAmount, currency) : "—",
    plannedRR: base.plannedRR ? `${base.plannedRR.toFixed(2)}:1` : "—",
    netPnl: atExit.netPnl ? formatMoney(atExit.netPnl, currency) : "—",
    netPnlIsProjection,
  };
}

/**
 * The R-mode preview: the same computeRTrade the server stores with. Before
 * the trade closes, P&L is projected at the planned R:R — the number worth
 * seeing while the plan is all there is.
 */
export function buildRPreview(values: Partial<TradeFormInput>, currency: string): Preview | null {
  const risk = Number(values.plannedRisk);
  if (!Number.isFinite(risk) || risk <= 0) return null;
  const openedAt = values.openedAt ? new Date(values.openedAt) : new Date();
  const rr = values.plannedRR ? Number(values.plannedRR) : undefined;
  const plannedRR = rr !== undefined && Number.isFinite(rr) && rr > 0 ? rr : undefined;
  const closed = values.status === "CLOSED" && !!values.resultR && Number.isFinite(Number(values.resultR));
  const resultR = closed ? Number(values.resultR) : plannedRR;

  const r = computeRTrade({
    mode: "R_MULTIPLE",
    plannedRisk: risk,
    plannedRR,
    resultR,
    commission: values.commission ? Number(values.commission) || 0 : 0,
    swap: values.swap ? Number(values.swap) || 0 : 0,
    openedAt: Number.isNaN(openedAt.getTime()) ? new Date() : openedAt,
  });

  return {
    mode: "R_MULTIPLE",
    pips: r.rMultiple ? `${r.rMultiple.isNegative() ? "" : "+"}${r.rMultiple.toFixed(2)}R` : "—",
    riskAmount: formatMoney(risk, currency),
    plannedRR: plannedRR ? `1:${plannedRR}` : "—",
    netPnl: r.netPnl ? formatMoney(r.netPnl, currency) : "—",
    netPnlIsProjection: !closed && plannedRR !== undefined,
  };
}

export function buildWarnings(values: Partial<TradeFormInput>, instrument: InstrumentOption | undefined) {
  const entry = Number(values.entryPrice);
  if (!instrument || !values.direction || !Number.isFinite(entry) || entry <= 0) return [];
  const stopLoss = values.stopLoss ? Number(values.stopLoss) : undefined;
  const takeProfit = values.takeProfit ? Number(values.takeProfit) : undefined;
  const volumeLots = Number(values.volumeLots) || 0;
  const openedAt = values.openedAt ? new Date(values.openedAt) : new Date();
  const closedAt = values.closedAt ? new Date(values.closedAt) : undefined;

  try {
    return validateTradeGeometry({
      instrument: {
        symbol: instrument.symbol,
        pipSize: instrument.pipSize,
        contractSize: instrument.contractSize,
        digits: instrument.digits,
        quoteCurrency: instrument.quoteCurrency,
        assetClass: instrument.assetClass as AssetClass,
      },
      direction: values.direction,
      entryPrice: entry,
      stopLoss,
      takeProfit,
      volumeLots,
      openedAt,
      closedAt,
    });
  } catch {
    return [];
  }
}

export function PreviewStrip({ preview }: { preview: Preview | null }) {
  const t = useTranslations("trades.form.preview");
  return (
    <Panel className="bg-panel-sunken">
      <PanelBody className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label={preview?.mode === "R_MULTIPLE" ? t("result") : t("pips")} value={preview ? preview.pips : "—"} />
        <Stat label={t("risk")} value={preview ? preview.riskAmount : "—"} />
        <Stat label={t("plannedRR")} value={preview ? preview.plannedRR : "—"} />
        <Stat
          label={preview?.netPnlIsProjection ? t("netPnlAtTarget") : t("netPnl")}
          value={preview ? preview.netPnl : "—"}
          tone={
            preview?.netPnl && preview.netPnl.startsWith("-")
              ? "loss"
              : preview?.netPnl && preview.netPnl !== "—"
                ? "profit"
                : "neutral"
          }
        />
      </PanelBody>
    </Panel>
  );
}
