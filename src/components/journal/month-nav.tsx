import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button, ButtonGroup } from "@/components/ui";
import { shiftMonth } from "./date-utils";

/** Month navigation via plain links (`?month=YYYY-MM`) — no client state needed. */
export async function MonthNav({ month, currentMonth }: { month: string; currentMonth: string }) {
  const t = await getTranslations("journal.nav");
  return (
    <div className="flex items-center gap-2">
      <ButtonGroup>
        <Button asChild variant="default" size="sm" aria-label={t("previousMonth")}>
          <Link href={`/journal?month=${shiftMonth(month, -1)}`}>
            <ChevronLeft />
          </Link>
        </Button>
        <Button asChild variant="default" size="sm" aria-label={t("nextMonth")}>
          <Link href={`/journal?month=${shiftMonth(month, 1)}`}>
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
          <Link href={`/journal?month=${currentMonth}`}>{t("today")}</Link>
        </Button>
      )}
    </div>
  );
}
