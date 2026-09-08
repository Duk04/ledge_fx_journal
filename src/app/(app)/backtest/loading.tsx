import { Page } from "@/components/shell/page";
import { Panel, PanelBody, Skeleton } from "@/components/ui";

/**
 * The backtest routes are the slowest in the app: they read the coverage
 * table and `candleStorageBytes()`, which is a whole-relation size query.
 * Mirrors the real layout so nothing reflows when content lands — same
 * discipline as analytics/loading.tsx.
 */
export default function BacktestLoading() {
  return (
    <Page>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-3 w-56" />
        </div>
        <Skeleton className="h-8 w-40" />
      </div>

      <Panel>
        <PanelBody>
          <Skeleton className="mb-3 h-4 w-28" />
          <div className="flex flex-col gap-2.5">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelBody>
          <Skeleton className="mb-3 h-4 w-28" />
          <div className="flex flex-col gap-2.5">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        </PanelBody>
      </Panel>
    </Page>
  );
}
