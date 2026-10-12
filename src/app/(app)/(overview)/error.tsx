"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Page } from "@/components/shell/page";
import { ErrorState } from "@/components/ui";
import { reportClientError } from "@/lib/report-client-error";

/** Error boundaries must be Client Components (see node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md). */
export default function OverviewError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const t = useTranslations("dashboard.overviewError");
  useEffect(() => {
    reportClientError(error);
  }, [error]);

  return (
    <Page>
      <ErrorState
        title={t("title")}
        description={error.message || t("description")}
        retry={{ label: t("retry"), onClick: retry }}
      />
    </Page>
  );
}
