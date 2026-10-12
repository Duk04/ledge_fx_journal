"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Page } from "@/components/shell/page";
import { ErrorState } from "@/components/ui";
import { reportClientError } from "@/lib/report-client-error";

/**
 * Analytics gets its own boundary because the message differs: this is the
 * heaviest query path in the app — six reports over one cached account load —
 * and the group-level boundary would say "Couldn't load the overview", which
 * is the wrong page.
 *
 * `retry`, not `reset`: Next 16.3 stabilised the `retry` prop and recommends
 * it (see node_modules/next/dist/docs/.../file-conventions/error.md).
 */
export default function AnalyticsError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const t = useTranslations("analytics.error");
  useEffect(() => {
    reportClientError(error);
  }, [error]);

  return (
    <Page>
      <ErrorState
        title={t("title")}
        description={error.digest ? t("descriptionRef", { digest: error.digest }) : error.message || t("description")}
        retry={{ label: t("retry"), onClick: retry }}
      />
    </Page>
  );
}
