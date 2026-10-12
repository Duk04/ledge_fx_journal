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

  // The one place colours are literal: this page renders when the root
  // layout — and with it globals.css and every token — may not have loaded.
  // The values are copied from the grey ramp in src/app/globals.css (canvas,
  // ink, ink-2, line, panel) and follow the OS colour scheme, as Next's own
  // default error page does; if the ramp changes, change them here too.
  return (
    <html lang="en">
      <head>
        <style>{`
          .ge { --bg:#f4f6f9; --ink:#0f1319; --ink2:#525a66; --line:#d3d9e2; --panel:#ffffff; }
          @media (prefers-color-scheme: dark) {
            .ge { --bg:#090b0f; --ink:#e9ecf1; --ink2:#8d96a3; --line:#262c34; --panel:#14181e; }
          }
        `}</style>
      </head>
      <body
        className="ge"
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          fontFamily: "system-ui, -apple-system, sans-serif",
          background: "var(--bg)",
          color: "var(--ink)",
        }}
      >
        <main style={{ maxWidth: "34rem", padding: "2rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.125rem", fontWeight: 600, margin: "0 0 0.5rem" }}>Ledger couldn&rsquo;t start</h1>
          <p style={{ fontSize: "0.875rem", lineHeight: 1.6, color: "var(--ink2)", margin: "0 0 1.5rem" }}>
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
              border: "1px solid var(--line)",
              background: "var(--panel)",
              color: "var(--ink)",
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
