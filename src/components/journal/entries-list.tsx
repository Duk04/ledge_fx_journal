import Link from "next/link";
import type { MonthEntrySummary } from "@/lib/queries/journal";

const MOOD_EMOJI: Record<number, string> = { 1: "😞", 2: "😕", 3: "😐", 4: "🙂", 5: "😄" };

/** The list of this month's entries under the calendar: date, mood, first line of the plan. */
export function EntriesList({ entries }: { entries: MonthEntrySummary[] }) {
  if (entries.length === 0) {
    return <p className="px-3 py-8 text-center text-xs text-ink-3">No journal entries yet this month.</p>;
  }

  return (
    <ul className="divide-y divide-line-faint">
      {entries.map((e) => (
        <li key={e.date}>
          <Link href={`/journal/${e.date}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-hover">
            <span className="mono w-24 shrink-0 text-xs text-ink-2">{e.date}</span>
            <span className="w-5 shrink-0 text-center text-sm" aria-hidden>
              {e.mood ? MOOD_EMOJI[e.mood] : "—"}
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
