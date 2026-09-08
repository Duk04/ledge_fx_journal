import Link from "next/link";
import { Page } from "@/components/shell/page";
import { EmptyState } from "@/components/ui";

/**
 * The root 404. There was none, so every mistyped URL rendered Next's
 * unstyled default — which on a publicly deployed app is one of the more
 * likely first impressions a visitor gets.
 *
 * Deliberately NOT inside the `(app)` group: an unauthenticated visitor
 * hitting a bad URL should see this, not the signed-in shell with an empty
 * nav. It gets its own minimal layout instead of the app chrome.
 */
export default function NotFound() {
  return (
    <Page width="reading">
      <EmptyState
        title="That page doesn't exist"
        description="The link may be out of date, or the address mistyped."
        action={undefined}
      />
      <p className="mt-4 text-center text-xs text-ink-3">
        <Link href="/" className="text-brand underline-offset-4 hover:underline">
          Back to the dashboard
        </Link>
      </p>
    </Page>
  );
}
