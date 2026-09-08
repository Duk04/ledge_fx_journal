"use client";

import { useEffect } from "react";
import { Page } from "@/components/shell/page";
import { ErrorState } from "@/components/ui";

/**
 * Analytics gets its own boundary because the message differs: this is the
 * heaviest query path in the app — six reports over one cached account load —
 * and the group-level boundary would say "Couldn't load the overview", which
 * is the wrong page.
 *
 * `retry`, not `reset`: Next 16.3 stabilised the `retry` prop and recommends
 * it (see node_modules/next/dist/docs/.../file-conventions/error.md).
 */
export default function AnalyticsError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Page>
      <ErrorState
        title="Couldn't load analytics"
        description={
          error.digest
            ? `Something went wrong building the reports (ref: ${error.digest}).`
            : error.message || "Something went wrong building the reports."
        }
        retry={{ label: "Try again", onClick: retry }}
      />
    </Page>
  );
}
