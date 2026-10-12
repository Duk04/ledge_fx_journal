import "server-only";
import { createTranslator } from "next-intl";
import en from "../../../messages/en.json";
import mn from "../../../messages/mn.json";
import { isLocale, type Locale } from "@/i18n/config";
import { formatMoney, formatPercent } from "@/lib/metrics/formatters";

/**
 * The two notification emails, in the recipient's language (User.locale —
 * there is no request to read a cookie from).
 *
 * WHY RAW COLOURS HERE. Mail clients ignore stylesheets and custom
 * properties, so the design tokens cannot reach an email: inline literals are
 * the only thing that renders. They mirror the light theme's ink, line and
 * brand tokens in globals.css; this file is the one place they are repeated.
 *
 * Every value that came from a user (name, account label, symbol) goes
 * through `esc()` — a trade's symbol is user-chosen text in an HTML body.
 */

const C = {
  ink: "#1a1d24",
  ink2: "#4b5262",
  ink3: "#6b7280",
  line: "#e4e6eb",
  brand: "#33488f",
  profit: "#15803d",
  loss: "#b91c1c",
};

const MESSAGES = { en, mn } as const;

function translator(locale: string) {
  const l: Locale = isLocale(locale) ? locale : "en";
  return createTranslator({ locale: l, messages: MESSAGES[l] as typeof en, namespace: "email" });
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function layout(
  body: string,
  footer: { why: string; unsubscribe?: string; unsubscribeUrl?: string; settings?: string; settingsUrl?: string },
) {
  // A transactional mail (a password reset) has no unsubscribe: it is sent
  // because someone asked for it, once.
  const links =
    footer.unsubscribe && footer.unsubscribeUrl && footer.settings && footer.settingsUrl
      ? `<br>
<a href="${esc(footer.unsubscribeUrl)}" style="color:${C.ink3}">${esc(footer.unsubscribe)}</a> · <a href="${esc(footer.settingsUrl)}" style="color:${C.ink3}">${esc(footer.settings)}</a>`
      : "";
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,Segoe UI,Inter,Arial,sans-serif;color:${C.ink}">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid ${C.line};border-radius:10px;padding:24px">
<div style="font-weight:600;font-size:14px;color:${C.brand};margin-bottom:16px">Ledger</div>
${body}
</div>
<p style="max-width:560px;margin:16px auto 0;font-size:12px;color:${C.ink3};line-height:1.5">${esc(footer.why)}${links}</p>
</body></html>`;
}

function button(label: string, href: string) {
  return `<a href="${esc(href)}" style="display:inline-block;margin-top:16px;padding:8px 14px;border-radius:6px;background:${C.brand};color:#ffffff;text-decoration:none;font-size:14px;font-weight:500">${esc(label)}</a>`;
}

interface Links {
  appUrl: string;
  unsubscribeUrl: string;
}

export function journalReminderEmail(
  input: { locale: string; date: string; tradeCount: number } & Links,
): RenderedEmail {
  const t = translator(input.locale);
  const journalUrl = new URL(`/journal/${input.date}`, input.appUrl).toString();
  const settingsUrl = new URL("/settings?tab=notifications", input.appUrl).toString();
  const body = t("reminder.body", { count: input.tradeCount, date: input.date });
  const html = layout(
    `<h1 style="font-size:18px;margin:0 0 8px">${esc(t("reminder.heading"))}</h1>
<p style="font-size:14px;line-height:1.55;color:${C.ink2};margin:0">${esc(body)}</p>
${button(t("reminder.cta"), journalUrl)}`,
    {
      why: t("why"),
      unsubscribe: t("unsubscribe"),
      unsubscribeUrl: input.unsubscribeUrl,
      settings: t("settings"),
      settingsUrl,
    },
  );
  const text = [
    t("reminder.heading"),
    "",
    body,
    "",
    `${t("reminder.cta")}: ${journalUrl}`,
    "",
    t("why"),
    `${t("unsubscribe")}: ${input.unsubscribeUrl}`,
  ].join("\n");
  return { subject: t("reminder.subject"), html, text };
}

export interface WeekAccountRow {
  label: string;
  currency: string;
  trades: number;
  netPnl: number;
  /** 0–1, null with no decided trades. */
  winRate: number | null;
}

export interface WeekTrade {
  symbol: string;
  currency: string;
  netPnl: number;
}

export function weeklySummaryEmail(
  input: {
    locale: string;
    /** The Monday that starts the week, "YYYY-MM-DD". */
    week: string;
    accounts: WeekAccountRow[];
    best: WeekTrade | null;
    worst: WeekTrade | null;
    journal: { entries: number; days: number };
  } & Links,
): RenderedEmail {
  const t = translator(input.locale);
  const settingsUrl = new URL("/settings?tab=notifications", input.appUrl).toString();
  const money = (n: number, ccy: string) => formatMoney(n, ccy);
  const tone = (n: number) => (n > 0 ? C.profit : n < 0 ? C.loss : C.ink);
  const cell = `padding:6px 8px;border-bottom:1px solid ${C.line};font-size:13px`;
  const num = `${cell};text-align:right;font-variant-numeric:tabular-nums`;

  const rows = input.accounts
    .map(
      (a) => `<tr><td style="${cell}">${esc(a.label)}</td><td style="${num}">${a.trades}</td>
<td style="${num};color:${tone(a.netPnl)}">${esc(money(a.netPnl, a.currency))}</td><td style="${num}">${esc(formatPercent(a.winRate))}</td></tr>`,
    )
    .join("");
  const th = `padding:6px 8px;border-bottom:1px solid ${C.line};font-size:11px;color:${C.ink3};text-transform:uppercase;letter-spacing:.04em`;
  const extreme = (label: string, tr: WeekTrade | null) =>
    tr
      ? `<p style="font-size:13px;margin:4px 0;color:${C.ink2}">${esc(label)}: <strong style="color:${C.ink}">${esc(tr.symbol)}</strong> <span style="color:${tone(tr.netPnl)}">${esc(money(tr.netPnl, tr.currency))}</span></p>`
      : "";
  const journalLine = t("summary.journalDays", {
    entries: String(input.journal.entries),
    days: String(input.journal.days),
  });

  const html = layout(
    `<h1 style="font-size:18px;margin:0 0 4px">${esc(t("summary.heading", { week: input.week }))}</h1>
<p style="font-size:13px;color:${C.ink3};margin:0 0 12px">${esc(t("summary.intro"))}</p>
<table style="width:100%;border-collapse:collapse"><thead><tr>
<th style="${th};text-align:left">${esc(t("summary.account"))}</th><th style="${th};text-align:right">${esc(t("summary.trades"))}</th>
<th style="${th};text-align:right">${esc(t("summary.netPnl"))}</th><th style="${th};text-align:right">${esc(t("summary.winRate"))}</th>
</tr></thead><tbody>${rows}</tbody></table>
<div style="margin-top:12px">${extreme(t("summary.best"), input.best)}${extreme(t("summary.worst"), input.worst)}
<p style="font-size:13px;margin:4px 0;color:${C.ink2}">${esc(journalLine)}</p></div>
${button(t("summary.cta"), input.appUrl)}`,
    {
      why: t("why"),
      unsubscribe: t("unsubscribe"),
      unsubscribeUrl: input.unsubscribeUrl,
      settings: t("settings"),
      settingsUrl,
    },
  );

  const text = [
    t("summary.heading", { week: input.week }),
    "",
    ...input.accounts.map(
      (a) => `${a.label}: ${a.trades} · ${money(a.netPnl, a.currency)} · ${formatPercent(a.winRate)}`,
    ),
    "",
    input.best ? `${t("summary.best")}: ${input.best.symbol} ${money(input.best.netPnl, input.best.currency)}` : "",
    input.worst
      ? `${t("summary.worst")}: ${input.worst.symbol} ${money(input.worst.netPnl, input.worst.currency)}`
      : "",
    journalLine,
    "",
    `${t("summary.cta")}: ${input.appUrl}`,
    "",
    t("why"),
    `${t("unsubscribe")}: ${input.unsubscribeUrl}`,
  ]
    .filter((l, i, all) => l !== "" || all[i - 1] !== "")
    .join("\n");

  return { subject: t("summary.subject", { week: input.week }), html, text };
}

export function passwordResetEmail(input: { locale: string; resetUrl: string; minutes: number }): RenderedEmail {
  const t = translator(input.locale);
  const body = t("reset.body", { minutes: String(input.minutes) });
  const html = layout(
    `<h1 style="font-size:18px;margin:0 0 8px">${esc(t("reset.heading"))}</h1>
<p style="font-size:14px;line-height:1.55;color:${C.ink2};margin:0">${esc(body)}</p>
${button(t("reset.cta"), input.resetUrl)}`,
    { why: t("reset.why") },
  );
  const text = [t("reset.heading"), "", body, "", `${t("reset.cta")}: ${input.resetUrl}`, "", t("reset.why")].join(
    "\n",
  );
  return { subject: t("reset.subject"), html, text };
}
