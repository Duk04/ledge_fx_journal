import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Page } from "@/components/shell/page";
import { EmptyState } from "@/components/ui";

/** Same shape as the trade 404: user-scoped lookups mean "not yours" and
 * "not there" have to look identical. */
export default async function RunNotFound() {
  const t = await getTranslations("backtest.run");
  return (
    <Page width="reading">
      <EmptyState title={t("notFoundTitle")} description={t("notFoundDescription")} />
      <p className="mt-4 text-center text-xs text-ink-3">
        <Link href="/backtest" className="text-brand underline-offset-4 hover:underline">
          {t("back")}
        </Link>
      </p>
    </Page>
  );
}
