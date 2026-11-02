import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Page } from "@/components/shell/page";
import { EmptyState } from "@/components/ui";

/**
 * The root 404. There was none, so every mistyped URL rendered Next's
 * unstyled default — which on a publicly deployed app is one of the more
 * likely first impressions a visitor gets.
 *
 * Deliberately NOT inside the `(app)` group, so it renders without the app
 * chrome, under the root layout alone. (An unauthenticated visitor rarely
 * sees it: the middleware sends a signed-out request for any non-public
 * path to /login first.)
 */
export default async function NotFound() {
  const t = await getTranslations("ui.notFound");
  return (
    <Page width="reading">
      <EmptyState title={t("title")} description={t("description")} />
      <p className="mt-4 text-center text-xs text-ink-3">
        <Link href="/" className="text-brand underline-offset-4 hover:underline">
          {t("back")}
        </Link>
      </p>
    </Page>
  );
}
