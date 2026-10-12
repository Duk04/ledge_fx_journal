"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Page } from "@/components/shell/page";
import { Panel, PanelBody } from "@/components/ui/panel";
import { ErrorState } from "@/components/ui/empty";
import { reportClientError } from "@/lib/report-client-error";

/**
 * Route-level error boundary. Next.js requires this to be a Client Component,
 * even though every other file in this route is server-only.
 *
 * Takes `retry`, not `reset`: Next 16.3 stabilised the `retry` prop and
 * recommends it over `reset` (see
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md).
 * This comment used to claim this was the last file on the older API;
 * app/global-error.tsx still took `reset` until it was moved over as well.
 */
export default function TradesError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const t = useTranslations("trades");
  useEffect(() => {
    reportClientError(error);
  }, [error]);

  return (
    <Page>
      <Panel>
        <PanelBody>
          <ErrorState
            title={t("list.errorTitle")}
            description={error.digest ? t("list.errorDigest", { digest: error.digest }) : error.message}
            retry={{ label: t("common.tryAgain"), onClick: retry }}
          />
        </PanelBody>
      </Panel>
    </Page>
  );
}
