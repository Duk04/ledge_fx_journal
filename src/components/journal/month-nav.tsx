import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button, ButtonGroup } from "@/components/ui";
import { shiftMonth } from "./date-utils";

/** Month navigation via plain links (`?month=YYYY-MM`) — no client state needed. */
export function MonthNav({ month, currentMonth }: { month: string; currentMonth: string }) {
  return (
    <div className="flex items-center gap-2">
      <ButtonGroup>
        <Button asChild variant="default" size="sm" aria-label="Previous month">
          <Link href={`/journal?month=${shiftMonth(month, -1)}`}>
            <ChevronLeft />
          </Link>
        </Button>
        <Button asChild variant="default" size="sm" aria-label="Next month">
          <Link href={`/journal?month=${shiftMonth(month, 1)}`}>
            <ChevronRight />
          </Link>
        </Button>
      </ButtonGroup>
      {month === currentMonth ? (
        <Button variant="default" size="sm" disabled>
          Today
        </Button>
      ) : (
        <Button asChild variant="default" size="sm">
          <Link href={`/journal?month=${currentMonth}`}>Today</Link>
        </Button>
      )}
    </div>
  );
}
