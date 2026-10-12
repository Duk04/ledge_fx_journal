import { useTranslations } from "next-intl";
import { Panel, PanelHeader, PanelBody } from "@/components/ui";

/**
 * The strategy contract, right next to the editor — see
 * docs/BACKTEST.md and src/lib/backtest/types.ts (StrategyContext) for the
 * full version. This is deliberately the condensed form: enough to write a
 * first strategy without leaving the page, not a copy of the doc.
 */
/** Terms are code and stay as written. A definition is either a message key
 * or, for the two that are themselves object shapes, a literal: those are
 * code too, and their braces would also read as ICU placeholders. */
const API_TERMS = [
  ["ctx.bars", { key: "bars" }],
  ["ctx.i", { key: "i" }],
  ["ctx.bar", { literal: "{ ts, open, high, low, close, volume?, spread? }" }],
  ["ctx.position", { key: "position" }],
  ["ctx.equity / ctx.balance", { key: "equity" }],
  ["ctx.instrument", { literal: "{ symbol, digits, pipSize, contractSize, quoteCurrency, pointSize }" }],
  ["ctx.params", { key: "params" }],
  ["ctx.buy(order) / ctx.sell(order)", { key: "order" }],
  ["ctx.close(reason?)", { key: "close" }],
  ["ctx.modify({ stopLoss?, takeProfit? })", { key: "modify" }],
  ["ctx.log(message)", { key: "log" }],
  ["sma/ema/rsi/atr/stdev(values, period)", { key: "indicators" }],
  ["highest/lowest(values, period)", { key: "extremes" }],
  ["crossOver/crossUnder(a, b)", { key: "cross" }],
] as const;

export function StrategyApiReference() {
  const t = useTranslations("backtest.api");
  return (
    <Panel>
      <PanelHeader title={t("title")} caption={t("caption")} />
      <PanelBody className="flex flex-col gap-3 text-xs">
        <pre className="scroll-x mono rounded-control bg-panel-sunken p-2.5 text-2xs leading-relaxed text-ink-2">
          {`function onBar(ctx) { ... }   // called on every bar, oldest first
function init(ctx) { ... }    // optional, called once before bar 0`}
        </pre>
        <dl className="flex flex-col gap-1.5">
          {API_TERMS.map(([term, def]) => (
            <div key={term} className="flex flex-col gap-0.5 border-b border-line-faint pb-1.5 last:border-0 last:pb-0">
              <dt className="mono text-2xs text-brand">{term}</dt>
              <dd className="text-ink-3">{"key" in def ? t(def.key) : def.literal}</dd>
            </div>
          ))}
        </dl>
        <p className="text-2xs text-ink-3">{t("note")}</p>
      </PanelBody>
    </Panel>
  );
}
