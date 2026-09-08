import Link from "next/link";
import { Page } from "@/components/shell/page";
import { EmptyState } from "@/components/ui";

/** Same shape as the trade 404: user-scoped lookups mean "not yours" and
 * "not there" have to look identical. */
export default function RunNotFound() {
  return (
    <Page width="reading">
      <EmptyState
        title="That run isn't here"
        description="It may have been deleted, or it belongs to a different account."
      />
      <p className="mt-4 text-center text-xs text-ink-3">
        <Link href="/backtest" className="text-brand underline-offset-4 hover:underline">
          Back to backtesting
        </Link>
      </p>
    </Page>
  );
}
