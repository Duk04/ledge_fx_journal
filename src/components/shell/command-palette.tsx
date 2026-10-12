"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, Kbd, useModKey } from "@/components/ui";
import { cn } from "@/lib/cn";
import { NAV_GROUPS } from "./nav-items";

interface Command {
  id: string;
  label: string;
  hint: string;
  href: string;
  keywords?: string;
}

const ACTIONS: Command[] = [
  { id: "log", label: "Log a trade", hint: "Action", href: "/trades/new", keywords: "new add record" },
  { id: "import", label: "Import a statement", hint: "Action", href: "/trades/import", keywords: "mt4 mt5 csv upload" },
  { id: "size", label: "Size a position", hint: "Action", href: "/calculator", keywords: "lots risk calculator" },
  { id: "journal", label: "Write today's journal", hint: "Action", href: "/journal", keywords: "plan review notes" },
];

const NAV: Command[] = NAV_GROUPS.flatMap((g) =>
  g.items.map((i) => ({ id: i.href, label: i.label, hint: g.label, href: i.href })),
);

/**
 * ⌘K / Ctrl+K: jump anywhere, or start the common actions, from the
 * keyboard. A combobox: focus stays in the input, ↑/↓ move the highlight
 * (announced via aria-activedescendant), Enter runs it.
 */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const listId = React.useId();

  const q = query.trim().toLowerCase();
  const results = [...ACTIONS, ...NAV].filter(
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
        <DialogHeader title="Go to" className="sr-only" />
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Search className="size-4 shrink-0 text-ink-3" aria-hidden />
          <input
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={results[index] ? `${listId}-${results[index].id}` : undefined}
            aria-label="Search pages and actions"
            placeholder="Search pages and actions…"
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
        <ul id={listId} role="listbox" aria-label="Results" className="max-h-80 overflow-y-auto p-1">
          {results.length === 0 ? <li className="px-3 py-6 text-center text-xs text-ink-3">Nothing matches.</li> : null}
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
  const rows: [React.ReactNode, string][] = [
    [<Kbd key="n">N</Kbd>, "Log a trade"],
    [
      <span key="k" className="flex gap-1">
        <Kbd>{mod}</Kbd>
        <Kbd>K</Kbd>
      </span>,
      "Search pages and actions",
    ],
    [
      <span key="e" className="flex gap-1">
        <Kbd>{mod}</Kbd>
        <Kbd>Enter</Kbd>
      </span>,
      "Save the trade form",
    ],
    [<Kbd key="q">?</Kbd>, "This list"],
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader title="Keyboard shortcuts" />
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
