import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button, ButtonGroup } from "@/components/ui";
import { shiftMonth } from "./date-utils";

/** Month navigation via plain links (`?month=YYYY-MM`) — no client state
 * needed. `keep` carries the stats range (`from`/`to`) so paging the
 * calendar does not reset the cards above it. */
export async function MonthNav({
  month,
  currentMonth,
  keep = {},
}: {
  month: string;
  currentMonth: string;
  keep?: Record<string, string>;
}) {
  const t = await getTranslations("journal.nav");
  const href = (m: string) => `/journal?${new URLSearchParams({ ...keep, month: m }).toString()}`;
  return (
    <div className="flex items-center gap-2">
      <ButtonGroup>
        <Button asChild variant="default" size="sm" aria-label={t("previousMonth")}>
          <Link href={href(shiftMonth(month, -1))}>
            <ChevronLeft />
          </Link>
        </Button>
        <Button asChild variant="default" size="sm" aria-label={t("nextMonth")}>
          <Link href={href(shiftMonth(month, 1))}>
            <ChevronRight />
          </Link>
        </Button>
      </ButtonGroup>
      {month === currentMonth ? (
        <Button variant="default" size="sm" disabled>
          {t("today")}
        </Button>
      ) : (
        <Button asChild variant="default" size="sm">
          <Link href={href(currentMonth)}>{t("today")}</Link>
        </Button>
      )}
    </div>
  );
}
