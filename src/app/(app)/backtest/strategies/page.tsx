import Link from "next/link";
import { Plus } from "lucide-react";
import { Page } from "@/components/shell/page";
import { SectionHead, Panel, PanelHeader, PanelBody, Button, Badge, EmptyState } from "@/components/ui";
import { RValue } from "@/components/ui/value";
import { cn } from "@/lib/cn";
import { requireUser } from "@/lib/session";
import { listStrategies, getStrategy } from "@/lib/queries/backtests";
import { listCoverage } from "@/lib/queries/candles";
import { EXAMPLE_STRATEGIES } from "@/lib/backtest";
import { StrategyWorkbench } from "@/components/backtest/strategies/strategy-workbench";

export default async function StrategiesPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  const user = await requireUser();

  const [strategies, coverage, selected] = await Promise.all([
    listStrategies(user.id),
    listCoverage(user.id),
    id ? getStrategy(user.id, id) : Promise.resolve(null),
  ]);

  const symbolOptions = Array.from(new Set(coverage.map((c) => c.symbol))).sort();

  return (
    <Page>
      <SectionHead
        title="Strategies"
        hint="Write a strategy once, replay it over any range, and tune it against real fill costs."
        actions={
          <Button asChild variant="default" size="sm">
            <Link href="/backtest/strategies">
              <Plus /> New
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-3">
          <Panel>
            <PanelHeader title="Saved" caption={strategies.length ? `${strategies.length}` : undefined} />
            {strategies.length === 0 ? (
              <PanelBody>
                <EmptyState title="No strategies yet" description="Start from a template on the right, then save it." />
              </PanelBody>
            ) : (
              <nav className="flex flex-col p-1.5">
                {strategies.map((s) => {
                  const active = s.id === id;
                  const stats = s.lastRun?.stats;
                  return (
                    <Link
                      key={s.id}
                      href={`/backtest/strategies?id=${s.id}`}
                      className={cn(
                        "flex flex-col gap-0.5 rounded-[3px] px-2 py-1.5 text-sm",
                        active ? "bg-selected text-ink" : "text-ink-2 hover:bg-hover",
                      )}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">{s.name}</span>
                        {s.lastRun ? <Badge tone={s.lastRun.status === "DONE" ? "neutral" : "warn"}>{s.lastRun.status}</Badge> : null}
                      </span>
                      {stats ? (
                        <span className="mono text-2xs text-ink-3">
                          {stats.tradeCount} trades · <RValue value={stats.expectancyR} className="text-2xs" />
                        </span>
                      ) : (
                        <span className="text-2xs text-ink-3">never run</span>
                      )}
                    </Link>
                  );
                })}
              </nav>
            )}
          </Panel>
        </div>

        <div className="lg:col-span-9">
          <StrategyWorkbench
            key={id ?? "new"}
            strategy={selected}
            templates={EXAMPLE_STRATEGIES}
            symbolOptions={symbolOptions}
            coverage={coverage}
          />
        </div>
      </div>
    </Page>
  );
}
