import { Page } from "@/components/shell/page";
import { Panel, PanelBody, Skeleton } from "@/components/ui";

/** Mirrors the month calendar so the grid doesn't jump when it resolves. */
export default function JournalLoading() {
  return (
    <Page>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-3 w-44" />
        </div>
        <Skeleton className="h-8 w-36" />
      </div>

      <Panel>
        <PanelBody>
          <Skeleton className="mb-3 h-4 w-28" />
          <div className="grid grid-cols-7 gap-1.5">
            {Array.from({ length: 35 }, (_, i) => (
              <Skeleton key={i} className="aspect-square w-full" />
            ))}
          </div>
        </PanelBody>
      </Panel>
    </Page>
  );
}
