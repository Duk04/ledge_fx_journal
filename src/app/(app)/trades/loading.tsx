import { Page } from "@/components/shell/page";
import { Panel, PanelFooter } from "@/components/ui/panel";
import { DataTable, Th } from "@/components/ui/table";
import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";

/** Mirrors the real page's shape (stat row + table) at the row height the
 * table actually uses, so real rows don't cause a layout jump when they
 * arrive. */
export default function TradesLoading() {
  return (
    <Page>
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-8 w-28" />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-6 w-20" />
          </div>
        ))}
      </div>

      <Skeleton className="h-8 w-full" />

      <Panel flush>
        <DataTable>
          <thead>
            <tr>
              <Th>Opened</Th>
              <Th>Symbol</Th>
              <Th>Dir</Th>
              <Th numeric>Entry → Exit</Th>
              <Th numeric>Lots</Th>
              <Th numeric>Pips</Th>
              <Th numeric>Net P&L</Th>
              <Th numeric>R</Th>
              <Th>R</Th>
              <Th>Tags</Th>
              <Th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            <SkeletonRows rows={10} cols={11} />
          </tbody>
        </DataTable>
        <PanelFooter>
          <Skeleton className="h-4 w-24" />
        </PanelFooter>
      </Panel>
    </Page>
  );
}
