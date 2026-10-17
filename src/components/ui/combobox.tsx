"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { useTranslations } from "next-intl";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { useFieldControlProps } from "./field";

export interface ComboboxOption {
  value: string;
  /** Already translated / display-ready. */
  label: string;
  /** Secondary text on the right, e.g. an instrument's display name. */
  hint?: string;
  /** Extra search terms that are not shown. */
  keywords?: string;
}

/**
 * Folds "EUR/USD", "eur usd" and "EURUSD" to the same key. Pairs are written
 * every way by brokers and people alike; a search that only matched one
 * spelling would look broken on the other two.
 */
function normalise(s: string) {
  return s.toLowerCase().replace(/[\s/._-]+/g, "");
}

export function filterOptions(options: ComboboxOption[], query: string): ComboboxOption[] {
  const q = normalise(query);
  if (!q) return options;
  return options.filter((o) => normalise(`${o.label} ${o.hint ?? ""} ${o.keywords ?? ""}`).includes(q));
}

/**
 * A Select you can type into — for lists too long to scroll (the instrument
 * list is ~70 symbols). Below a dozen known options, use Select instead.
 *
 * The trigger is styled as SelectTrigger so the two are interchangeable in a
 * form. The popover holds a combobox input and a listbox, with the same
 * keyboard model as the command palette: focus stays in the input, ↑/↓ move
 * the highlight (announced via aria-activedescendant), Enter picks.
 *
 * `name` renders a hidden input so the value submits with a plain <form>.
 */
export function Combobox({
  options,
  value,
  onValueChange,
  placeholder,
  searchPlaceholder,
  emptyText,
  name,
  disabled,
  className,
  "aria-label": ariaLabel,
  "aria-invalid": ariaInvalid,
  id,
}: {
  options: ComboboxOption[];
  value: string | undefined;
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  name?: string;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  id?: string;
}) {
  const t = useTranslations("ui.combobox");
  const fieldProps = useFieldControlProps();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const listId = React.useId();
  const listRef = React.useRef<HTMLUListElement>(null);

  const results = filterOptions(options, query);
  const index = Math.min(active, Math.max(0, results.length - 1));
  const selected = options.find((o) => o.value === value);

  function openWithSelection(next: boolean) {
    setOpen(next);
    if (next) {
      setQuery("");
      // Start the highlight on the current value so ↓ continues from it.
      setActive(
        Math.max(
          0,
          options.findIndex((o) => o.value === value),
        ),
      );
    }
  }

  function pick(o: ComboboxOption | undefined) {
    if (!o) return;
    onValueChange(o.value);
    setOpen(false);
  }

  // Keep the highlighted option in view while arrowing through a long list.
  React.useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [index, open]);

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={openWithSelection}>
      <PopoverPrimitive.Trigger
        type="button"
        disabled={disabled}
        {...fieldProps}
        id={id ?? fieldProps.id}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid ?? fieldProps["aria-invalid"]}
        aria-haspopup="listbox"
        data-placeholder={selected ? undefined : ""}
        className={cn(
          "flex h-control w-full items-center justify-between gap-2 rounded-control border border-line bg-panel px-2.5 text-sm text-ink",
          "transition-[border-color,box-shadow] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
          "hover:border-line-strong",
          "focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-weak",
          "disabled:pointer-events-none disabled:opacity-45",
          "data-[placeholder]:text-ink-3",
          "aria-invalid:border-loss aria-invalid:ring-loss/20",
          className,
        )}
      >
        <span className="truncate">{selected ? selected.label : placeholder}</span>
        <ChevronDown className="size-3.5 shrink-0 text-ink-3" aria-hidden />
      </PopoverPrimitive.Trigger>
      {name ? <input type="hidden" name={name} value={value ?? ""} /> : null}
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          className={cn(
            "z-50 w-[var(--radix-popover-trigger-width)] min-w-56 overflow-hidden",
            "rounded-[var(--radius-overlay)] border border-line bg-panel-raised text-ink shadow-overlay",
          )}
        >
          <div className="flex items-center gap-2 border-b border-line px-2.5">
            <Search className="size-3.5 shrink-0 text-ink-3" aria-hidden />
            <input
              autoFocus
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={results[index] ? `${listId}-${index}` : undefined}
              aria-label={searchPlaceholder ?? t("search")}
              placeholder={searchPlaceholder ?? t("search")}
              className="h-9 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
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
                  // Never let Enter submit the surrounding form from here.
                  e.preventDefault();
                  pick(results[index]);
                }
              }}
            />
          </div>
          <ul ref={listRef} id={listId} role="listbox" className="max-h-64 overflow-y-auto p-1">
            {results.length === 0 ? (
              <li className="px-3 py-5 text-center text-xs text-ink-3">{emptyText ?? t("empty")}</li>
            ) : null}
            {results.map((o, i) => (
              <li
                key={o.value}
                id={`${listId}-${i}`}
                data-index={i}
                role="option"
                aria-selected={o.value === value}
                onMouseMove={() => setActive(i)}
                onClick={() => pick(o)}
                className={cn(
                  "relative flex h-8 cursor-default select-none items-center gap-2 rounded-inner px-2 pr-7 text-sm",
                  i === index ? "bg-hover text-ink" : "text-ink-2",
                )}
              >
                <span className="shrink-0 font-medium">{o.label}</span>
                {o.hint ? <span className="truncate text-xs text-ink-3">{o.hint}</span> : null}
                {o.value === value ? <Check className="absolute right-2 size-3.5 text-brand" aria-hidden /> : null}
              </li>
            ))}
          </ul>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

/** The two shapes pair lists arrive in, mapped to Combobox options. */
export function instrumentOptions(
  instruments: readonly ({ symbol: string; displayName?: string | null } | string)[],
): ComboboxOption[] {
  return instruments.map((i) =>
    typeof i === "string"
      ? { value: i, label: i }
      : { value: i.symbol, label: i.symbol, hint: i.displayName ?? undefined },
  );
}
