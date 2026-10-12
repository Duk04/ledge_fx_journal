"use client";

import { useEffect } from "react";
import { Page } from "@/components/shell/page";
import { ErrorState } from "@/components/ui";

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
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Page>
      <ErrorState
        title="Couldn't load this page"
        description={
          error.digest
            ? `Something went wrong on our end (ref: ${error.digest}).`
            : error.message || "Something went wrong loading this page."
        }
        retry={{ label: "Try again", onClick: retry }}
      />
    </Page>
  );
}
