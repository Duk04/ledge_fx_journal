"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Textarea } from "@/components/ui";
import { setTradeNotes } from "@/lib/actions/trades";

/**
 * A trade's note, edited where the trade is being looked at — its own page
 * and the list's screenshot dialog — instead of only inside the full edit
 * form. The same contract as the journal's fields (docs/JOURNAL.md, "The
 * autosave contract"): it saves on blur, only if the text changed, and says
 * so beside its label. There is no save button to forget.
 *
 * It also saves when it UNMOUNTS with unsaved text. Blur does not fire for a
 * field that is removed while focused, which is exactly what Escape on the
 * dialog does — and a note typed and then lost to the Escape key is the kind
 * of thing that stops someone writing them.
 */
export function TradeNotesField({
  accountId,
  tradeId,
  initialNotes,
  savedNotes = initialNotes,
  onCommit,
  onSaved,
  rows = 3,
}: {
  accountId: string;
  tradeId: string;
  /** The text the field opens with. */
  initialNotes: string;
  /** What the server holds, when that is not `initialNotes`: a parent that
   * remounts this field hands back text whose save had not landed yet, and
   * the field must still know it has something to save. */
  savedNotes?: string;
  /** Called with the text as a save of it STARTS (blur, or unmount) — what a
   * remounting parent should hand back as `initialNotes`. */
  onCommit?: (notes: string) => void;
  /** Called with the text once the server has it. */
  onSaved?: (notes: string) => void;
  rows?: number;
}) {
  const t = useTranslations("trades.notes");
  const id = React.useId();
  const [value, setValue] = React.useState(initialNotes);
  const [status, setStatus] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = React.useState<string | null>(null);

  // What the server has, and what is typed: refs, so the unmount cleanup
  // below reads the latest of both without re-subscribing on every keystroke.
  const lastSaved = React.useRef(savedNotes);
  const latest = React.useRef(initialNotes);
  // The text of the save now on its way, so the blur that starts one and the
  // unmount right behind it (clicking "Next" does both) send it once.
  const inFlight = React.useRef<string | null>(null);
  const onCommitRef = React.useRef(onCommit);
  const onSavedRef = React.useRef(onSaved);
  React.useEffect(() => {
    onCommitRef.current = onCommit;
    onSavedRef.current = onSaved;
  }, [onCommit, onSaved]);

  const save = React.useCallback(
    async (text: string) => {
      if (text === lastSaved.current || text === inFlight.current) return;
      inFlight.current = text;
      onCommitRef.current?.(text);
      setStatus("saving");
      setError(null);
      const result = await setTradeNotes(accountId, tradeId, text);
      if (inFlight.current === text) inFlight.current = null;
      if (result.ok) {
        lastSaved.current = text;
        setStatus("saved");
        onSavedRef.current?.(text);
      } else {
        setStatus("error");
        setError(result.formError ?? result.fieldErrors?.notes?.[0] ?? t("couldNotSave"));
      }
    },
    [accountId, tradeId, t],
  );

  React.useEffect(() => {
    return () => {
      void save(latest.current);
    };
  }, [save]);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium text-ink-2">
          {t("label")}
        </label>
        <span className="shrink-0 text-2xs text-ink-3" role="status">
          {status === "saving" ? t("saving") : null}
          {status === "saved" ? t("saved") : null}
          {status === "error" ? <span className="text-loss">{error}</span> : null}
        </span>
      </div>
      <Textarea
        id={id}
        rows={rows}
        value={value}
        maxLength={4000}
        placeholder={t("placeholder")}
        onChange={(e) => {
          setValue(e.target.value);
          latest.current = e.target.value;
          if (status !== "idle") setStatus("idle");
        }}
        onBlur={() => void save(latest.current)}
      />
    </div>
  );
}
