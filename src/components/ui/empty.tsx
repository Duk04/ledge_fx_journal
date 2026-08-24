import * as React from "react";
import { cn } from "@/lib/cn";
import { Button } from "./button";

type Action = { label: string; onClick: () => void };

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: Action;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-3 px-6 py-12 text-center", className)}>
      {icon ? (
        <div className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-control)] bg-inset text-ink-3">
          {icon}
        </div>
      ) : null}
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-ink">{title}</p>
        {description ? <p className="max-w-xs text-xs text-ink-3">{description}</p> : null}
      </div>
      {action ? (
        <Button size="sm" onClick={action.onClick} className="mt-1">
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}

/** Same shape as EmptyState, tinted for a failure rather than a lack of data —
 * the difference between "nothing here yet" and "something went wrong". */
export function ErrorState({
  title = "Something went wrong",
  description,
  retry,
  className,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  retry?: Action;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-3 px-6 py-12 text-center", className)}>
      <div className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-control)] bg-loss-weak text-loss">
        <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
          <path
            d="M8 1.5 1.5 13.5h13L8 1.5Z M8 6.25v3.25 M8 11.75h.01"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-ink">{title}</p>
        {description ? <p className="max-w-xs text-xs text-ink-3">{description}</p> : null}
      </div>
      {retry ? (
        <Button size="sm" variant="danger" onClick={retry.onClick} className="mt-1">
          {retry.label}
        </Button>
      ) : null}
    </div>
  );
}
