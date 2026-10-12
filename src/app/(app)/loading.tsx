import { Page } from "@/components/shell/page";
import { Panel, PanelBody, Skeleton, SkeletonText } from "@/components/ui";

/**
 * Fallback for every route in the group that has no loading.tsx of its own
 * (accounts, settings, a journal day, a trade's detail/new/edit pages).
 *
 * Deliberately shapeless — a heading and one panel. It used to be the
 * Overview's skeleton, six stat tiles and an equity chart, which then flashed
 * up on the way to the settings page. Pages with a known layout get their own
 * skeleton beside them; (overview)/, trades/(list)/ and journal/(month)/ are
 * route groups for exactly that reason, so their skeletons stop at their own
 * page instead of covering every sibling route.
 */
export default function AppLoading() {
  return (
    <Page>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-36" />
        <Skeleton className="h-3 w-52" />
      </div>
      <Panel>
        <PanelBody>
          <SkeletonText lines={5} />
        </PanelBody>
      </Panel>
    </Page>
  );
}
