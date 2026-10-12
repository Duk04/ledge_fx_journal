import Link from "next/link";
import { format, parseISO } from "date-fns";
import { NotebookPen } from "lucide-react";
import { EmptyState } from "@/components/ui";
import type { MonthEntrySummary } from "@/lib/queries/journal";

const MOOD_EMOJI: Record<number, string> = { 1: "😞", 2: "😕", 3: "😐", 4: "🙂", 5: "😄" };
/** The emoji is decoration; this is what a screen reader hears instead. */
const MOOD_WORD: Record<number, string> = { 1: "bad", 2: "poor", 3: "neutral", 4: "good", 5: "great" };

/** The list of this month's entries under the calendar: date, mood, first line of the plan. */
export function EntriesList({ entries }: { entries: MonthEntrySummary[] }) {
  if (entries.length === 0) {
    return (
      <EmptyState
        icon={<NotebookPen className="size-4" />}
        title="No entries this month"
        description="Pick a day on the calendar to write a pre-market plan or an end-of-day review."
      />
    );
  }

  return (
    <ul className="divide-y divide-line-faint">
      {entries.map((e) => (
        <li key={e.date}>
          <Link href={`/journal/${e.date}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-hover">
            <span className="mono w-24 shrink-0 text-xs text-ink-2">{format(parseISO(e.date), "EEE, MMM d")}</span>
            <span className="w-5 shrink-0 text-center text-sm">
              <span aria-hidden>{e.mood ? MOOD_EMOJI[e.mood] : "—"}</span>
              <span className="sr-only">{e.mood ? `Mood: ${MOOD_WORD[e.mood]}` : "No mood recorded"}</span>
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-ink-2">
              {e.snippet ?? <span className="text-ink-3">No pre-market note.</span>}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
