"use client";

import { Page } from "@/components/shell/page";
import { Panel, PanelBody } from "@/components/ui/panel";
import { ErrorState } from "@/components/ui/empty";

/**
 * Route-level error boundary. Next.js requires this to be a Client Component,
 * even though every other file in this route is server-only.
 *
 * Takes `retry`, not `reset`: Next 16.3 stabilised the `retry` prop and
 * recommends it over `reset` (see
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md).
 * This file was the last one still on the older API.
 */
export default function TradesError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <Page>
      <Panel>
        <PanelBody>
          <ErrorState
            title="Couldn't load trades"
            description={error.digest ? `Something went wrong on our end (ref: ${error.digest}).` : error.message}
            retry={{ label: "Try again", onClick: retry }}
          />
        </PanelBody>
      </Panel>
    </Page>
  );
}
