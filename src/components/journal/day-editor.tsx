"use client";

import * as React from "react";
import { Textarea, Segmented, SegmentedItem, Label2 } from "@/components/ui";
import { saveJournalEntry, setMood as setMoodAction } from "@/lib/actions/journal";

/**
 * Autosave contract (see docs/JOURNAL.md): each Textarea is its own
 * independent field. It saves on blur, only if its value actually changed
 * since the last successful save, and shows one of three states next to its
 * label — "Saving…", "Saved HH:MM", or an inline error — never a separate
 * submit button. Mood saves immediately on selection, same principle.
 */

const MOOD_LABELS: Record<string, string> = { "1": "😞", "2": "😕", "3": "😐", "4": "🙂", "5": "😄" };
const MOOD_VALUES = ["1", "2", "3", "4", "5"] as const;

function formatSavedAt(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function FieldEditor({
  date,
  field,
  label,
  placeholder,
  initialValue,
  initialSavedAt,
}: {
  date: string;
  field: "preMarket" | "review";
  label: string;
  placeholder: string;
  initialValue: string;
  initialSavedAt: string | null;
}) {
  const [value, setValue] = React.useState(initialValue);
  const [status, setStatus] = React.useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
  const [savedAt, setSavedAt] = React.useState<string | null>(initialSavedAt);
  const [error, setError] = React.useState<string | null>(null);
  const lastSaved = React.useRef(initialValue);

  async function commit() {
    if (value === lastSaved.current) return;
    setStatus("saving");
    setError(null);
    const result = await saveJournalEntry({ date, field, value });
    if (result.ok) {
      lastSaved.current = value;
      setSavedAt(result.savedAt ?? new Date().toISOString());
      setStatus("saved");
    } else {
      setStatus("error");
      setError(result.formError ?? Object.values(result.fieldErrors ?? {})[0]?.[0] ?? "Could not save.");
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-xs font-medium text-ink-2">{label}</label>
        <span className="shrink-0 text-2xs text-ink-3">
          {status === "saving" ? "Saving…" : null}
          {status === "saved" && savedAt ? `Saved ${formatSavedAt(savedAt)}` : null}
          {status === "error" ? <span className="text-loss">{error}</span> : null}
        </span>
      </div>
      <Textarea
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setStatus("dirty");
        }}
        onBlur={commit}
        placeholder={placeholder}
        className="min-h-32"
      />
    </div>
  );
}

export function DayEditor({
  date,
  preMarket,
  review,
  updatedAt,
  mood,
}: {
  date: string;
  preMarket: string;
  review: string;
  updatedAt: string | null;
  mood: number | null;
}) {
  const [currentMood, setCurrentMood] = React.useState<number | null>(mood);
  const [moodStatus, setMoodStatus] = React.useState<"idle" | "error">("idle");

  async function handleMoodChange(v: string) {
    const next = v ? Number(v) : null;
    const previous = currentMood;
    setCurrentMood(next);
    const result = await setMoodAction({ date, mood: next });
    setMoodStatus(result.ok ? "idle" : "error");
    if (!result.ok) setCurrentMood(previous);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <Label2>Mood</Label2>
          {moodStatus === "error" ? <span className="text-2xs text-loss">Could not save mood.</span> : null}
        </div>
        <Segmented value={currentMood ? String(currentMood) : ""} onValueChange={handleMoodChange}>
          {MOOD_VALUES.map((v) => (
            <SegmentedItem key={v} value={v} aria-label={`Mood ${v} of 5`}>
              <span aria-hidden>{MOOD_LABELS[v]}</span>
            </SegmentedItem>
          ))}
        </Segmented>
      </div>

      <FieldEditor
        date={date}
        field="preMarket"
        label="Pre-market plan"
        placeholder="What's the plan today? Bias, key levels, what would invalidate it…"
        initialValue={preMarket}
        initialSavedAt={updatedAt}
      />

      <FieldEditor
        date={date}
        field="review"
        label="Post-session review"
        placeholder="How did it actually go? Did you follow the plan?"
        initialValue={review}
        initialSavedAt={updatedAt}
      />
    </div>
  );
}
