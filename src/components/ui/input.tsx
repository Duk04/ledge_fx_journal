"use client";

import * as React from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useFieldControlProps } from "./field";

/** Shared skin for anything that looks like a text field — kept in one place
 * so Input, NumberInput and Select's trigger can never drift apart. */
export const fieldSkin =
  "flex w-full items-center rounded-control border border-line bg-panel text-ink " +
  "transition-[border-color,box-shadow] duration-[var(--dur-fast)] ease-[var(--ease-out)] " +
  "placeholder:text-ink-3 " +
  "hover:border-line-strong " +
  "focus-within:border-brand focus-within:outline-none focus-within:ring-2 focus-within:ring-brand-weak " +
  "has-[input:disabled]:pointer-events-none has-[input:disabled]:opacity-45";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  const fieldProps = useFieldControlProps();
  return (
    <input
      {...fieldProps}
      className={cn(
        "h-control w-full rounded-control border border-line bg-panel px-2.5 text-sm text-ink",
        "placeholder:text-ink-3",
        "transition-[border-color,box-shadow] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
        "hover:border-line-strong",
        "focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-weak",
        "disabled:pointer-events-none disabled:opacity-45",
        "aria-invalid:border-loss aria-invalid:ring-loss/20",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A number field for trade entry — right-aligned and monospaced because these
 * numbers get compared vertically against everything else in the ledger.
 * `unit` renders inside the field (pips, lots, %) so the suffix never wraps
 * to its own line on a narrow form.
 */
export function NumberInput({ className, unit, ...props }: React.ComponentProps<"input"> & { unit?: React.ReactNode }) {
  const fieldProps = useFieldControlProps();
  return (
    <div
      className={cn(
        "flex h-control items-center gap-1 rounded-control border border-line bg-panel pr-2.5 pl-2.5",
        "transition-[border-color,box-shadow] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
        "hover:border-line-strong",
        "has-[input:focus-visible]:border-brand has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-brand-weak",
        "has-[input:disabled]:pointer-events-none has-[input:disabled]:opacity-45",
        "has-[input[aria-invalid=true]]:border-loss has-[input[aria-invalid=true]]:ring-loss/20",
        className,
      )}
    >
      <input
        {...fieldProps}
        inputMode="decimal"
        className={cn(
          "mono min-w-0 flex-1 bg-transparent text-right text-sm text-ink outline-none",
          "placeholder:text-ink-3",
        )}
        {...props}
      />
      {unit ? <span className="shrink-0 text-xs text-ink-3">{unit}</span> : null}
    </div>
  );
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  const fieldProps = useFieldControlProps();
  return (
    <textarea
      {...fieldProps}
      className={cn(
        "min-h-20 w-full resize-y rounded-control border border-line bg-panel px-2.5 py-2 text-sm text-ink",
        "placeholder:text-ink-3",
        "transition-[border-color,box-shadow] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
        "hover:border-line-strong",
        "focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-weak",
        "disabled:pointer-events-none disabled:opacity-45",
        "aria-invalid:border-loss aria-invalid:ring-loss/20",
        className,
      )}
      {...props}
    />
  );
}

/**
 * The clear button only mounts once there's something to clear — an empty
 * search box with an X in it invites a click that does nothing.
 */
export function SearchInput({
  className,
  value,
  onClear,
  ...props
}: React.ComponentProps<"input"> & { onClear?: () => void }) {
  const hasValue = typeof value === "string" ? value.length > 0 : value !== undefined && value !== null;
  return (
    <div
      className={cn(
        "flex h-control w-full items-center gap-1.5 rounded-control border border-line bg-panel pr-1.5 pl-2.5",
        "transition-[border-color,box-shadow] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
        "hover:border-line-strong",
        "has-[input:focus-visible]:border-brand has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-brand-weak",
        "has-[input:disabled]:pointer-events-none has-[input:disabled]:opacity-45",
        className,
      )}
    >
      <Search className="size-3.5 shrink-0 text-ink-3" aria-hidden />
      <input
        type="text"
        value={value}
        className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
        {...props}
      />
      {hasValue && onClear ? (
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear search"
          className="grid size-5 shrink-0 place-items-center rounded-inner text-ink-3 hover:bg-hover hover:text-ink"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
