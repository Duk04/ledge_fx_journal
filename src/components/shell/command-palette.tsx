"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, Kbd, useModKey } from "@/components/ui";
import { cn } from "@/lib/cn";
import { NAV_GROUPS } from "./nav-items";

interface Command {
  id: string;
  /** Already translated. */
  label: string;
  hint: string;
  href: string;
  /** English search aliases, so "mt4" finds the importer in either language. */
  keywords?: string;
}

const ACTIONS = [
  { id: "log", key: "logTrade", href: "/trades/new", keywords: "log new add record trade" },
  { id: "import", key: "import", href: "/trades/import", keywords: "import mt4 mt5 csv upload statement" },
  { id: "size", key: "size", href: "/calculator", keywords: "size lots risk calculator position" },
  { id: "journal", key: "journal", href: "/journal", keywords: "journal plan review notes" },
] as const;

/**
 * ⌘K / Ctrl+K: jump anywhere, or start the common actions, from the
 * keyboard. A combobox: focus stays in the input, ↑/↓ move the highlight
 * (announced via aria-activedescendant), Enter runs it.
 */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const t = useTranslations("palette");
  const tNav = useTranslations("nav");
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const listId = React.useId();

  const commands: Command[] = [
    ...ACTIONS.map((a) => ({ id: a.id, label: t(a.key), hint: t("action"), href: a.href, keywords: a.keywords })),
    ...NAV_GROUPS.flatMap((g) =>
      g.items.map((i) => ({ id: i.href, label: tNav(i.label), hint: tNav(g.label), href: i.href, keywords: i.label })),
    ),
  ];
  const q = query.trim().toLowerCase();
  const results = commands.filter(
    (c) => !q || c.label.toLowerCase().includes(q) || c.keywords?.includes(q) || c.hint.toLowerCase().includes(q),
  );
  const index = Math.min(active, Math.max(0, results.length - 1));

  function run(c: Command | undefined) {
    if (!c) return;
    onOpenChange(false);
    router.push(c.href);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setQuery("");
          setActive(0);
        }
      }}
    >
      <DialogContent size="md" showClose={false}>
        <DialogHeader title={t("title")} className="sr-only" />
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Search className="size-4 shrink-0 text-ink-3" aria-hidden />
          <input
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={results[index] ? `${listId}-${results[index].id}` : undefined}
            aria-label={t("search")}
            placeholder={t("placeholder")}
            className="h-11 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((index + 1) % Math.max(1, results.length));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((index - 1 + results.length) % Math.max(1, results.length));
              } else if (e.key === "Enter") {
                e.preventDefault();
                run(results[index]);
              }
            }}
          />
        </div>
        <ul id={listId} role="listbox" aria-label={t("results")} className="max-h-80 overflow-y-auto p-1">
          {results.length === 0 ? <li className="px-3 py-6 text-center text-xs text-ink-3">{t("none")}</li> : null}
          {results.map((c, i) => (
            <li
              key={c.id}
              id={`${listId}-${c.id}`}
              role="option"
              aria-selected={i === index}
              onMouseMove={() => setActive(i)}
              onClick={() => run(c)}
              className={cn(
                "flex cursor-pointer items-center justify-between rounded-control px-2.5 py-2 text-sm",
                i === index ? "bg-hover text-ink" : "text-ink-2",
              )}
            >
              <span>{c.label}</span>
              <span className="text-2xs text-ink-3">{c.hint}</span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

/** "?": what the keyboard can do. */
export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const mod = useModKey();
  const t = useTranslations("palette");
  const rows: [React.ReactNode, string][] = [
    [<Kbd key="n">N</Kbd>, t("scLog")],
    [
      <span key="k" className="flex gap-1">
        <Kbd>{mod}</Kbd>
        <Kbd>K</Kbd>
      </span>,
      t("scSearch"),
    ],
    [
      <span key="e" className="flex gap-1">
        <Kbd>{mod}</Kbd>
        <Kbd>Enter</Kbd>
      </span>,
      t("scSave"),
    ],
    [<Kbd key="q">?</Kbd>, t("scHelp")],
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader title={t("shortcuts")} />
        <dl className="flex flex-col gap-2 p-4 pt-0 text-sm">
          {rows.map(([keys, label]) => (
            <div key={label} className="flex items-center justify-between gap-3">
              <dt className="text-ink-2">{label}</dt>
              <dd className="text-ink">{keys}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
