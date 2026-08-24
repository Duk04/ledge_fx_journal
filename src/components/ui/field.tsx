"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Wires id / aria-describedby / aria-invalid across a Field's children without
 * every call site having to invent and thread an id by hand. FieldHint and
 * FieldError register themselves into the describedby list; FieldError also
 * flips the field into its invalid state.
 */
const FieldContext = React.createContext<{
  id: string;
  describedBy: string[];
  register: (id: string) => () => void;
  invalid: boolean;
  setInvalid: (v: boolean) => void;
} | null>(null);

function useFieldContext(explicitId?: string) {
  const ctx = React.useContext(FieldContext);
  return { id: explicitId ?? ctx?.id, ctx };
}

export function Field({
  id,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { id?: string }) {
  const generatedId = React.useId();
  const autoId = id ?? generatedId;
  const [describedBy, setDescribedBy] = React.useState<string[]>([]);
  const [invalid, setInvalid] = React.useState(false);

  const register = React.useCallback((entryId: string) => {
    setDescribedBy((prev) => (prev.includes(entryId) ? prev : [...prev, entryId]));
    return () => setDescribedBy((prev) => prev.filter((v) => v !== entryId));
  }, []);

  const value = React.useMemo(
    () => ({ id: autoId, describedBy, register, invalid, setInvalid }),
    [autoId, describedBy, invalid, register],
  );

  return (
    <FieldContext.Provider value={value}>
      <div className={cn("flex flex-col gap-1.5", className)} {...props}>
        {children}
      </div>
    </FieldContext.Provider>
  );
}

/** Attach this to the actual control (Input, Select trigger, …). */
export function useFieldControlProps() {
  const ctx = React.useContext(FieldContext);
  if (!ctx) return {};
  return {
    id: ctx.id,
    "aria-describedby": ctx.describedBy.length ? ctx.describedBy.join(" ") : undefined,
    "aria-invalid": ctx.invalid || undefined,
  };
}

export function FieldLabel({
  className,
  optional,
  children,
  htmlFor,
  ...props
}: React.ComponentProps<"label"> & { optional?: boolean }) {
  const { id } = useFieldContext(htmlFor);
  return (
    <label htmlFor={id} className={cn("text-xs font-medium text-ink-2", className)} {...props}>
      {children}
      {optional ? <span className="ml-1 text-2xs font-normal text-ink-3">optional</span> : null}
    </label>
  );
}

export function FieldHint({ className, children, ...props }: React.ComponentProps<"p">) {
  const ctx = React.useContext(FieldContext);
  const hintId = React.useId();
  const fullId = `${ctx?.id ?? "field"}-hint-${hintId}`;
  const register = ctx?.register;

  // Depend on `register` itself (stable across Field re-renders), never on
  // `ctx` as a whole — that object is rebuilt every time describedBy/invalid
  // change, which would otherwise unregister and re-register on every render.
  React.useEffect(() => register?.(fullId), [register, fullId]);

  return (
    <p id={fullId} className={cn("text-2xs text-ink-3", className)} {...props}>
      {children}
    </p>
  );
}

export function FieldError({ className, children, ...props }: React.ComponentProps<"p">) {
  const ctx = React.useContext(FieldContext);
  const errId = React.useId();
  const fullId = `${ctx?.id ?? "field"}-error-${errId}`;
  const register = ctx?.register;
  const setInvalid = ctx?.setInvalid;
  const hasError = !!children;

  React.useEffect(() => {
    const unregister = register?.(fullId);
    setInvalid?.(hasError);
    return () => {
      unregister?.();
      setInvalid?.(false);
    };
  }, [register, setInvalid, fullId, hasError]);

  if (!children) return null;

  return (
    <p id={fullId} role="alert" className={cn("text-2xs text-loss", className)} {...props}>
      {children}
    </p>
  );
}

/** A responsive 2-up row for pairing short fields (e.g. entry / stop). */
export function FieldRow({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("grid gap-3 sm:grid-cols-2", className)} {...props} />;
}
