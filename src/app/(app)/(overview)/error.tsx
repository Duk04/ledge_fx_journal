"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Page } from "@/components/shell/page";
import { ErrorState } from "@/components/ui";
import { reportClientError } from "@/lib/report-client-error";

/** Error boundaries must be Client Components (see node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md). */
export default function OverviewError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const t = useTranslations("dashboard.overviewError");
  const tApp = useTranslations("dashboard.appError");
  useEffect(() => {
    reportClientError(error);
  }, [error]);

  return (
    <Page>
      <ErrorState
        title={t("title")}
        // The digest first, as the other boundaries do: in production a server
        // error's `message` is Next's generic English sentence, never empty, so
        // `message || description` never reached the translated copy.
        description={error.digest ? tApp("withDigest", { digest: error.digest }) : error.message || t("description")}
        retry={{ label: t("retry"), onClick: retry }}
      />
    </Page>
  );
}
