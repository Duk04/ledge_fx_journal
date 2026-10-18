"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, ListChecks, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, Checkbox, Input, Panel, PanelBody, PanelHeader, useToast } from "@/components/ui";
import {
  addChecklistItem,
  moveChecklistItem,
  removeChecklistItem,
  renameChecklistItem,
  setDailyCheck,
} from "@/lib/actions/checklist";
import type { DailyChecklist as DailyChecklistData } from "@/lib/queries/checklist";

/**
 * The daily checklist (docs/JOURNAL.md, "Daily checklist"): the user's own
 * list of what to look at before trading, ticked off for one day.
 *
 * Two modes. Ticking is the everyday one and must be instant, so a tick
 * flips locally first and is put back if the save fails. Editing the list
 * (add, rename, reorder, remove) is occasional and goes through the server
 * before the list changes.
 */
export function DailyChecklist({
  checklist,
  today = false,
}: {
  checklist: DailyChecklistData;
  /** On the month page: titled "Today's checklist", with a link to the day. */
  today?: boolean;
}) {
  const t = useTranslations("journal.checklist");
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  // Optimistic ticks, keyed by item id and tied to the list they were made
  // on: once the refreshed list arrives it is the truth, and they lapse.
  const [optimistic, setOptimistic] = React.useState<{ on: DailyChecklistData; ticks: Record<string, boolean> }>({
    on: checklist,
    ticks: {},
  });
  const ticks = optimistic.on === checklist ? optimistic.ticks : {};
  const setTick = (id: string, checked: boolean) =>
    setOptimistic((prev) => ({
      on: checklist,
      ticks: { ...(prev.on === checklist ? prev.ticks : {}), [id]: checked },
    }));
  const [draft, setDraft] = React.useState("");
  const [draftError, setDraftError] = React.useState<string | null>(null);

  const items = checklist.items.map((i) => ({ ...i, checked: ticks[i.id] ?? i.checked }));
  const done = items.filter((i) => i.checked).length;
  const total = items.length;
  const empty = total === 0;
  const showEditor = editing || empty;

  function fail(message?: string) {
    toast({ title: t("saveFailed"), description: message, tone: "loss" });
  }

  function toggle(id: string, checked: boolean) {
    setTick(id, checked);
    startTransition(async () => {
      const res = await setDailyCheck({ itemId: id, date: checklist.date, checked });
      if (!res.ok) {
        setTick(id, !checked);
        fail(res.formError);
        return;
      }
      router.refresh();
    });
  }

  function run(fn: () => Promise<{ ok: boolean; formError?: string; fieldErrors?: Record<string, string[]> }>) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) fail(res.formError ?? Object.values(res.fieldErrors ?? {})[0]?.[0]);
      else router.refresh();
    });
  }

  function add(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    // Adding the first item ends the empty state; stay in edit mode so the
    // next one can be typed straight after, until "Done".
    setEditing(true);
    startTransition(async () => {
      const res = await addChecklistItem({ text });
      if (!res.ok) {
        setDraftError(res.fieldErrors?.text?.[0] ?? res.formError ?? null);
        return;
      }
      setDraft("");
      setDraftError(null);
      router.refresh();
    });
  }

  return (
    <Panel>
      <PanelHeader
        title={today ? t("titleToday") : t("title")}
        caption={empty ? undefined : done === total ? t("allDone", { total }) : t("progress", { done, total })}
        actions={
          <div className="flex items-center gap-1">
            {today ? (
              <Button asChild variant="ghost" size="sm">
                <Link href={`/journal/${checklist.date}`}>{t("openDay")}</Link>
              </Button>
            ) : null}
            {empty ? null : (
              <Button variant="ghost" size="sm" onClick={() => setEditing(!editing)}>
                {editing ? t("done") : t("edit")}
              </Button>
            )}
          </div>
        }
      />
      {!empty ? (
        <div className="h-1 bg-line" aria-hidden>
          <div
            className="h-full bg-profit transition-[width] duration-[var(--dur)]"
            style={{ width: `${(done / total) * 100}%` }}
          />
        </div>
      ) : null}
      <PanelBody className="flex flex-col gap-1">
        {empty ? (
          <div className="flex items-start gap-3 pb-2">
            <ListChecks className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-ink">{t("emptyTitle")}</span>
              <span className="text-xs text-ink-3">{t("emptyBody")}</span>
            </div>
          </div>
        ) : null}

        <ul className="flex flex-col">
          {items.map((item, index) =>
            showEditor && !item.archived ? (
              <EditRow
                key={item.id}
                text={item.text}
                first={index === 0}
                last={index === items.filter((i) => !i.archived).length - 1}
                disabled={pending}
                onRename={(text) => run(() => renameChecklistItem({ id: item.id, text }))}
                onMove={(direction) => run(() => moveChecklistItem({ id: item.id, direction }))}
                onRemove={() => run(() => removeChecklistItem({ id: item.id }))}
              />
            ) : (
              <li key={item.id}>
                <label
                  className={cn(
                    "flex min-h-9 cursor-pointer items-center gap-3 rounded-control px-1.5 py-1 hover:bg-hover",
                    item.archived && "cursor-default hover:bg-transparent",
                  )}
                >
                  <Checkbox
                    checked={item.checked}
                    disabled={item.archived}
                    onCheckedChange={(v) => toggle(item.id, v === true)}
                  />
                  <span className={cn("text-sm", item.checked ? "text-ink-3 line-through" : "text-ink")}>
                    {item.text}
                  </span>
                  {item.archived ? <span className="text-2xs text-ink-3">({t("archivedNote")})</span> : null}
                </label>
              </li>
            ),
          )}
        </ul>

        {showEditor ? (
          <form onSubmit={add} className="mt-1 flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Input
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setDraftError(null);
                }}
                placeholder={t("addPlaceholder")}
                aria-label={t("addPlaceholder")}
                aria-invalid={draftError ? true : undefined}
                maxLength={200}
              />
              <Button type="submit" variant="default" disabled={pending || !draft.trim()}>
                <Plus /> {t("add")}
              </Button>
            </div>
            {draftError ? <p className="text-xs text-loss">{draftError}</p> : null}
          </form>
        ) : null}
      </PanelBody>
    </Panel>
  );
}

/** One item in edit mode: its text is an input that saves on blur, with
 * move and remove beside it. */
function EditRow({
  text,
  first,
  last,
  disabled,
  onRename,
  onMove,
  onRemove,
}: {
  text: string;
  first: boolean;
  last: boolean;
  disabled: boolean;
  onRename: (text: string) => void;
  onMove: (direction: "up" | "down") => void;
  onRemove: () => void;
}) {
  const t = useTranslations("journal.checklist");
  const [value, setValue] = React.useState(text);
  return (
    <li className="flex items-center gap-1.5 py-1">
      <Input
        value={value}
        aria-label={t("rename", { text })}
        maxLength={200}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          const next = value.trim();
          if (next && next !== text) onRename(next);
          else setValue(text);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
      />
      <Button
        variant="ghost"
        size="sm"
        aria-label={t("moveUp", { text })}
        title={t("moveUp", { text })}
        disabled={disabled || first}
        onClick={() => onMove("up")}
      >
        <ArrowUp />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-label={t("moveDown", { text })}
        title={t("moveDown", { text })}
        disabled={disabled || last}
        onClick={() => onMove("down")}
      >
        <ArrowDown />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-label={t("remove", { text })}
        title={t("remove", { text })}
        disabled={disabled}
        onClick={onRemove}
      >
        <Trash2 />
      </Button>
    </li>
  );
}
