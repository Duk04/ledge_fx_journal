import { describe, expect, it } from "vitest";
import { dueNotifications } from "./schedule";

const UB = "Asia/Ulaanbaatar"; // UTC+8, no DST
const both = { journalReminder: true, weeklySummary: true, sendHour: 20 };

describe("dueNotifications", () => {
  it("nothing is due before the chosen local hour", () => {
    // 11:59 UTC = 19:59 in Ulaanbaatar on a Monday, so neither the
    // reminder nor the week's summary has reached 20:00 yet.
    expect(dueNotifications(both, UB, new Date("2026-10-12T11:59:00Z"))).toEqual([]);
  });

  it("the reminder is due from the chosen hour to the end of the local day", () => {
    for (const at of ["2026-10-14T12:00:00Z", "2026-10-14T15:59:00Z"]) {
      const due = dueNotifications({ ...both, weeklySummary: false }, UB, new Date(at));
      expect(due).toEqual([
        {
          kind: "JOURNAL_REMINDER",
          periodKey: "2026-10-14",
          from: new Date("2026-10-13T16:00:00Z"),
          to: new Date("2026-10-14T16:00:00Z"),
        },
      ]);
    }
  });

  it("uses the local date, not the UTC one", () => {
    // 16:30 UTC Wednesday is already 00:30 Thursday in Ulaanbaatar.
    const due = dueNotifications(
      { journalReminder: true, weeklySummary: false, sendHour: 0 },
      UB,
      new Date("2026-10-14T16:30:00Z"),
    );
    expect(due[0].periodKey).toBe("2026-10-15");
  });

  it("the summary covers last Monday to this Monday and stays due all week", () => {
    const monday = dueNotifications(
      { ...both, journalReminder: false, sendHour: 8 },
      UB,
      new Date("2026-10-12T00:00:00Z"),
    );
    expect(monday).toEqual([
      {
        kind: "WEEKLY_SUMMARY",
        periodKey: "2026-10-05",
        from: new Date("2026-10-04T16:00:00Z"),
        to: new Date("2026-10-11T16:00:00Z"),
      },
    ]);
    // Sunday evening, same week: still the same period, so the log row dedupes it.
    const sunday = dueNotifications(
      { ...both, journalReminder: false, sendHour: 8 },
      UB,
      new Date("2026-10-18T12:00:00Z"),
    );
    expect(sunday[0].periodKey).toBe("2026-10-05");
  });

  it("Monday before the chosen hour is not yet due", () => {
    // 07:59 Monday in Ulaanbaatar.
    expect(
      dueNotifications({ ...both, journalReminder: false, sendHour: 8 }, UB, new Date("2026-10-11T23:59:00Z")),
    ).toEqual([]);
  });

  it("a DST week is still Monday-to-Monday in local time", () => {
    // Europe/London leaves summer time on Sunday 2026-10-25.
    const due = dueNotifications(
      { journalReminder: false, weeklySummary: true, sendHour: 9 },
      "Europe/London",
      new Date("2026-10-26T10:00:00Z"),
    );
    expect(due[0]).toMatchObject({
      periodKey: "2026-10-19",
      from: new Date("2026-10-18T23:00:00Z"), // 00:00 BST
      to: new Date("2026-10-26T00:00:00Z"), // 00:00 GMT
    });
  });

  it("nothing when both are off", () => {
    expect(dueNotifications({ journalReminder: false, weeklySummary: false, sendHour: 0 }, UB, new Date())).toEqual([]);
  });
});
