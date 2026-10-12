import { describe, expect, it } from "vitest";
import { journalReminderEmail, weeklySummaryEmail } from "./templates";

const links = {
  appUrl: "https://ledger.test",
  unsubscribeUrl: "https://ledger.test/api/notifications/unsubscribe?u=1",
};

describe("journalReminderEmail", () => {
  it("renders in the recipient's language, with the journal link and the unsubscribe link", () => {
    const en = journalReminderEmail({ locale: "en", date: "2026-10-14", tradeCount: 3, ...links });
    expect(en.subject).toBe("You traded today — your journal is still empty");
    expect(en.text).toContain("3 trades on 2026-10-14");
    expect(en.html).toContain('href="https://ledger.test/journal/2026-10-14"');
    expect(en.html).toContain(links.unsubscribeUrl);

    const mn = journalReminderEmail({ locale: "mn", date: "2026-10-14", tradeCount: 1, ...links });
    expect(mn.subject).toBe("Өнөөдөр арилжаа хийсэн ч тэмдэглэл хоосон байна");
    expect(mn.text).toContain("1 арилжаа");
  });

  it("falls back to English for an unknown locale", () => {
    expect(journalReminderEmail({ locale: "xx", date: "2026-10-14", tradeCount: 1, ...links }).text).toContain(
      "1 trade on",
    );
  });
});

describe("weeklySummaryEmail", () => {
  const base = {
    locale: "en",
    week: "2026-10-05",
    best: { symbol: "EURUSD", currency: "USD", netPnl: 120 },
    worst: { symbol: "XAUUSD", currency: "USD", netPnl: -80.5 },
    journal: { entries: 2, days: 4 },
    ...links,
  };

  it("lists each account with its own currency", () => {
    const mail = weeklySummaryEmail({
      ...base,
      accounts: [
        { label: "Live", currency: "USD", trades: 5, netPnl: 39.5, winRate: 0.6 },
        { label: "JPY demo", currency: "JPY", trades: 2, netPnl: -1500, winRate: 0 },
      ],
    });
    expect(mail.subject).toBe("Your trading week of 2026-10-05");
    expect(mail.text).toContain("Live: 5 · $39.50 · 60.0%");
    expect(mail.text).toContain("JPY demo: 2 · -¥1,500 · 0.0%");
    expect(mail.text).toContain("Best trade: EURUSD $120.00");
    expect(mail.text).toContain("Journal entries: 2 of 4 trading days.");
  });

  it("escapes user-chosen text in the HTML body", () => {
    const mail = weeklySummaryEmail({
      ...base,
      accounts: [{ label: '<img src=x onerror="alert(1)">', currency: "USD", trades: 1, netPnl: 1, winRate: 1 }],
      best: { symbol: "<b>X</b>", currency: "USD", netPnl: 1 },
    });
    expect(mail.html).not.toContain("<img src=x");
    expect(mail.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(mail.html).toContain("&lt;b&gt;X&lt;/b&gt;");
  });
});
