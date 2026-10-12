import { TZDate } from "@date-fns/tz";

/**
 * Which notifications are due for one user at one instant. Pure: the cron
 * route supplies `now`, the tests supply any instant they like.
 *
 * DUE MEANS "AT OR AFTER", NOT "DURING". A user who picked 20:00 is due from
 * 20:00 until the end of that local day (a reminder) or week (a summary),
 * not only inside the 20:00 hour. The NotificationLog row's unique key is
 * what makes that safe — the first run in the window sends, every later one
 * finds the row and skips. In exchange, a cron that ran late, skipped an
 * hour, or (on a free host) runs once a day still delivers, instead of
 * silently missing everyone whose hour it did not land on. A DST jump that
 * skips the chosen hour is covered by the same rule.
 */

export type NotificationKindName = "JOURNAL_REMINDER" | "WEEKLY_SUMMARY";

export interface SchedulePrefs {
  journalReminder: boolean;
  weeklySummary: boolean;
  /** 0–23, local to the user's timezone. */
  sendHour: number;
}

export interface DueNotification {
  kind: NotificationKindName;
  /** The NotificationLog key: the local date for a reminder, the Monday that
   * starts the summarised week for a summary. */
  periodKey: string;
  /** The window the notification is about, as instants: today for a
   * reminder, last Monday 00:00 → this Monday 00:00 for a summary. */
  from: Date;
  to: Date;
}

function key(d: TZDate): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Local midnight `days` days from `d`'s date. Built from calendar fields,
 * not by adding 24h, so a DST day is still one day long. */
function localMidnight(d: TZDate, days: number, timeZone: string): TZDate {
  return new TZDate(d.getFullYear(), d.getMonth(), d.getDate() + days, 0, 0, 0, 0, timeZone);
}

export function dueNotifications(prefs: SchedulePrefs, timeZone: string, now: Date): DueNotification[] {
  const local = new TZDate(now, timeZone);
  const today = localMidnight(local, 0, timeZone);
  const due: DueNotification[] = [];

  if (prefs.journalReminder && local.getHours() >= prefs.sendHour) {
    due.push({
      kind: "JOURNAL_REMINDER",
      periodKey: key(today),
      from: new Date(today.getTime()),
      to: new Date(localMidnight(local, 1, timeZone).getTime()),
    });
  }

  if (prefs.weeklySummary) {
    const sinceMonday = (local.getDay() + 6) % 7;
    const thisMonday = localMidnight(local, -sinceMonday, timeZone);
    const sendAt = new TZDate(
      thisMonday.getFullYear(),
      thisMonday.getMonth(),
      thisMonday.getDate(),
      prefs.sendHour,
      0,
      0,
      0,
      timeZone,
    );
    if (now.getTime() >= sendAt.getTime()) {
      const lastMonday = localMidnight(thisMonday, -7, timeZone);
      due.push({
        kind: "WEEKLY_SUMMARY",
        periodKey: key(lastMonday),
        from: new Date(lastMonday.getTime()),
        to: new Date(thisMonday.getTime()),
      });
    }
  }

  return due;
}
