"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { ErrorState } from "@/components/ui";
import { reportClientError } from "@/lib/report-client-error";

/**
 * The boundary for what `(app)/error.tsx` cannot catch: an error thrown by a
 * LAYOUT — `(app)/layout.tsx` queries the database for the account switcher
 * — is handled by the boundary above that layout, not beside it. Without this
 * file that meant global-error.tsx: unstyled, English-only, and replacing the
 * whole document. This one renders inside the root layout, so the theme, the
 * fonts and the reader's language still apply.
 *
 * `retry`, not `reset` (stable since Next 16.3 — see
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md).
 */
export default function RootError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const t = useTranslations("dashboard.appError");
  useEffect(() => {
    reportClientError(error);
  }, [error]);

  return (
    <div className="mx-auto w-full max-w-xl p-6">
      <ErrorState
        title={t("title")}
        description={error.digest ? t("withDigest", { digest: error.digest }) : error.message || t("generic")}
        retry={{ label: t("retry"), onClick: retry }}
      />
    </div>
  );
}
