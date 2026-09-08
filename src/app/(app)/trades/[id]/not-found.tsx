import Link from "next/link";
import { Page } from "@/components/shell/page";
import { EmptyState } from "@/components/ui";

/**
 * A trade id that does not resolve.
 *
 * Worth its own boundary rather than falling through to the root 404, because
 * the message can be honest about the two cases it covers WITHOUT
 * distinguishing them: `getTrade` is scoped by userId, so a trade belonging to
 * someone else produces exactly this page, and saying "or isn't yours" is what
 * keeps that from being a way to probe which ids exist.
 */
export default function TradeNotFound() {
  return (
    <Page width="reading">
      <EmptyState
        title="That trade isn't here"
        description="It may have been deleted, or it belongs to a different account."
      />
      <p className="mt-4 text-center text-xs text-ink-3">
        <Link href="/trades" className="text-brand underline-offset-4 hover:underline">
          Back to all trades
        </Link>
      </p>
    </Page>
  );
}
