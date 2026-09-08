import { cn } from "@/lib/cn";
import { formatMoney, formatPercent, formatPips, formatR } from "@/lib/metrics/formatters";

type Num = number | string | null | undefined;

/**
 * Values arrive from server components as plain numbers or decimal strings
 * (Prisma's Decimal cannot cross the serialization boundary), so normalise once
 * here rather than in every call site.
 */
function num(v: Num): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

function signClass(v: Num, colour: boolean) {
  if (!colour || v === null || v === undefined || v === "") return "";
  const n = Number(v);
  if (!Number.isFinite(n) || Math.abs(n) < 0.005) return "val-flat";
  return n > 0 ? "val-pos" : "val-neg";
}

/**
 * Money. Monospaced, tabular, and coloured by sign — but only the number is
 * coloured. Nothing around it changes, which is what keeps a table of 200 rows
 * from turning into a Christmas tree.
 */
export function Money({
  value,
  currency = "USD",
  colour = true,
  signed = false,
  className,
}: {
  value: Num;
  currency?: string;
  colour?: boolean;
  signed?: boolean;
  className?: string;
}) {
  const n = num(value);
  const text = formatMoney(n, currency);
  const prefix = signed && n !== null && n > 0 ? "+" : "";
  return (
    <span className={cn("mono", signClass(value, colour), className)}>
      {n === null ? text : prefix + text}
    </span>
  );
}

/** R multiple. Always signed — an unsigned R is meaningless at a glance. */
export function RValue({
  value,
  colour = true,
  className,
}: {
  value: Num;
  colour?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("mono", signClass(value, colour), className)}>{formatR(num(value))}</span>
  );
}

export function Pips({ value, colour = true, className }: { value: Num; colour?: boolean; className?: string }) {
  return <span className={cn("mono", signClass(value, colour), className)}>{formatPips(num(value))}</span>;
}

export function Percent({
  value,
  colour = false,
  digits = 1,
  className,
}: {
  value: Num;
  colour?: boolean;
  digits?: number;
  className?: string;
}) {
  return (
    <span className={cn("mono", signClass(value, colour), className)}>
      {formatPercent(num(value), digits)}
    </span>
  );
}

/** An em-dash placeholder, used everywhere a value is genuinely absent. */
export function Empty({ className }: { className?: string }) {
  return <span className={cn("text-ink-3", className)}>—</span>;
}
