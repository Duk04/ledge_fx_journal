"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Page } from "@/components/shell/page";
import { ErrorState } from "@/components/ui";
import { reportClientError } from "@/lib/report-client-error";

/**
 * Fallback boundary for every route in the group without its own error.tsx.
 * Its copy is page-agnostic on purpose: it used to say "Couldn't load the
 * overview" while standing in for settings, accounts and the journal.
 *
 * Error boundaries must be Client Components, and take `retry` rather than
 * `reset` (stable since Next 16.3 — see
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md).
 */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const t = useTranslations("dashboard.appError");
  useEffect(() => {
    reportClientError(error);
  }, [error]);

  return (
    <Page>
      <ErrorState
        title={t("title")}
        description={error.digest ? t("withDigest", { digest: error.digest }) : error.message || t("generic")}
        retry={{ label: t("retry"), onClick: retry }}
      />
    </Page>
  );
}
