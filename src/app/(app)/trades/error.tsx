"use client";

import { Page } from "@/components/shell/page";
import { Panel, PanelBody } from "@/components/ui/panel";
import { ErrorState } from "@/components/ui/empty";

/** Route-level error boundary. Next.js requires this to be a Client
 * Component (it needs to catch render errors, incl. from `reset()`), even
 * though every other file in this route is server-only. */
export default function TradesError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Page>
      <Panel>
        <PanelBody>
          <ErrorState
            title="Couldn't load trades"
            description={error.digest ? `Something went wrong on our end (ref: ${error.digest}).` : error.message}
            retry={{ label: "Try again", onClick: reset }}
          />
        </PanelBody>
      </Panel>
    </Page>
  );
}
