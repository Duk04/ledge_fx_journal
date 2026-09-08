import { Panel, PanelHeader, PanelBody } from "@/components/ui";

/**
 * The strategy contract, right next to the editor — see
 * docs/BACKTEST.md and src/lib/backtest/types.ts (StrategyContext) for the
 * full version. This is deliberately the condensed form: enough to write a
 * first strategy without leaving the page, not a copy of the doc.
 */
export function StrategyApiReference() {
  return (
    <Panel>
      <PanelHeader title="Strategy API" caption="what onBar(ctx) can read and call" />
      <PanelBody className="flex flex-col gap-3 text-xs">
        <pre className="scroll-x mono rounded-[var(--radius-control)] bg-panel-sunken p-2.5 text-2xs leading-relaxed text-ink-2">
          {`function onBar(ctx) { ... }   // called on every bar, oldest first
function init(ctx) { ... }    // optional, called once before bar 0`}
        </pre>
        <dl className="flex flex-col gap-1.5">
          {[
            ["ctx.bars", "bars up to and including this one — never the future"],
            ["ctx.i", "index of the current bar within ctx.bars"],
            ["ctx.bar", "{ ts, open, high, low, close, volume?, spread? }"],
            ["ctx.position", "the open SimPosition, or null"],
            ["ctx.equity / ctx.balance", "mark-to-market / last realized balance"],
            ["ctx.instrument", "{ symbol, digits, pipSize, contractSize, quoteCurrency, pointSize }"],
            ["ctx.params", "this run's parameter values"],
            ["ctx.buy(order) / ctx.sell(order)", "open at the NEXT bar's open — ignored if already in a position"],
            ["ctx.close(reason?)", "close the open position at the next bar's open"],
            ["ctx.modify({ stopLoss?, takeProfit? })", "move the stop/target immediately"],
            ["ctx.log(message)", "attach a diagnostic line to the run"],
            ["sma/ema/rsi/atr/stdev(values, period)", "indicators — same length as input, null while warming up"],
            ["highest/lowest(values, period)", "rolling extreme, null while warming up"],
            ["crossOver/crossUnder(a, b)", "boolean series — true only on the bar of the cross"],
          ].map(([term, def]) => (
            <div key={term} className="flex flex-col gap-0.5 border-b border-line-faint pb-1.5 last:border-0 last:pb-0">
              <dt className="mono text-2xs text-brand">{term}</dt>
              <dd className="text-ink-3">{def}</dd>
            </div>
          ))}
        </dl>
        <p className="text-2xs text-ink-3">
          One position at a time; a buy/sell while one is open is silently ignored. Orders fill at the NEXT bar&rsquo;s
          open, never the signal bar&rsquo;s own close — see docs/BACKTEST-ENGINE.md for why that rule exists.
        </p>
      </PanelBody>
    </Panel>
  );
}
