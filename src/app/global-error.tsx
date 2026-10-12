"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/report-client-error";

/**
 * The last-resort boundary: catches an error thrown by the ROOT layout, which
 * every other `error.tsx` sits inside and therefore cannot catch.
 *
 * Must render its own `<html>` and `<body>`, because the failure it handles is
 * the root layout not rendering — so there is no document to slot into, and no
 * shared providers, fonts or tokens to rely on. Hence the inline styles: the
 * stylesheet is part of what may not have loaded.
 *
 * Fifteen lines that turn a white screen into something explicable.
 *
 * `retry` (re-fetch and re-render), not `reset`, as everywhere else — see
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    reportClientError(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          fontFamily: "system-ui, -apple-system, sans-serif",
          background: "#0b0d10",
          color: "#e6e8eb",
        }}
      >
        <main style={{ maxWidth: "34rem", padding: "2rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.125rem", fontWeight: 600, margin: "0 0 0.5rem" }}>Ledger couldn&rsquo;t start</h1>
          <p style={{ fontSize: "0.875rem", lineHeight: 1.6, color: "#9aa4b2", margin: "0 0 1.5rem" }}>
            Something failed before the page could render.
            {error.digest ? ` Reference: ${error.digest}.` : ""}
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              font: "inherit",
              fontSize: "0.8125rem",
              padding: "0.5rem 1rem",
              borderRadius: "0.5rem",
              border: "1px solid #2a2f36",
              background: "#151a1f",
              color: "#e6e8eb",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
