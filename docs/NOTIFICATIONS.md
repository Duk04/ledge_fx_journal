# Notifications

Ledger has two kinds of nudge: one inside the app, and two by email. All of them are opt-in except the in-app strip, and each one is switched in Settings → Notifications.

| What | Where | When | Default |
|---|---|---|---|
| **Journal nudge** | Dashboard strip | Today (in your timezone) had a trade opened or closed, and there is no journal entry for today | On |
| **Journal reminder** | Email | Same condition, at or after your chosen hour | Off |
| **Weekly summary** | Email | Monday, at or after your chosen hour: last Monday→Sunday's closed trades per account, best/worst trade, journaled days | Off |

"Trading activity" means LIVE, DEMO and PROP accounts. Backtest accounts are left out, because replays and strategy runs are not a day anyone needs to journal. Archived accounts are left out too.

## The in-app strip

`JournalNudge` (`components/dashboard/journal-nudge.tsx`) asks `journalNudge()` in `lib/queries/notifications.ts` on each overview render. It needs no scheduler and no mail provider, so it works on every instance.

## Email

### Moving parts

- **`NotificationPrefs`:** one row per user. No row means the defaults above, so a user who never opened the tab gets no mail.
- **`NotificationLog`:** one row per user, kind and period, and the unique key on those three is the point of the table (see below).
  - The period of a reminder is the local date.
  - The period of a summary is the Monday the week starts on.
- **`lib/notifications/schedule.ts`:** a pure function that answers "which notifications are due for this user right now".
- **`lib/notifications/templates.ts`:** the two emails, rendered in `User.locale`. There is no request to read a cookie from.
- **`lib/email.ts`:** Resend's HTTP API, called with `fetch`. It never throws.
- **`app/api/cron/notifications/route.ts`:** the runner. A scheduler calls it hourly.
- **`app/api/notifications/unsubscribe/route.ts`:** the signed link in every email, and the `List-Unsubscribe-Post` one-click target.

### Due means "at or after", not "during"

A user who picked 20:00 is due from 20:00 until the end of that local day for the reminder, or that local week for the summary. Every run in that window finds the user due. **The log row decides who actually gets mail.** Before sending, the runner INSERTs the `(user, kind, period)` row, and the unique key turns a second insert into "already done".

That buys robustness to the scheduler:

- A late run, a skipped hour, or a DST jump over the chosen hour still delivers, later that day.
- Two overlapping runs, a retried request, or both schedulers below running at once still send one mail.

The cost is the other direction. **A send that fails stays `FAILED` for that period and is not retried.** A missed reminder is better than a duplicated one, and the error is kept on the row (`error`) for whoever looks.

### Nothing to say means no claim

The runner decides whether there is anything to send *before* it claims the period:

- **A reminder** needs activity today and no entry.
- **A summary** needs at least one closed trade.

This is deliberate. Someone with no trades yet at 20:00 who trades at 22:00 gets the reminder at the 23:00 run. If an empty run had claimed the day, they would not.

### Who gets mail

- **Opt-in only.** Every email carries a one-click unsubscribe link and the RFC 8058 headers.
- **Verification.** With `REQUIRE_EMAIL_VERIFICATION` on, only verified addresses get mail. With it off, the instance has no stronger proof of address than the signed-in opt-in itself. The worst a stranger who registers with your address can do is one reminder a day, and each one carries the off switch.

## Configuration

| Variable | Purpose |
|---|---|
| `RESEND_API_KEY` | Mail provider key. Falls back to `AUTH_RESEND_KEY`. Unset means the email switches render disabled, with the reason. |
| `EMAIL_FROM` | Sender address, shared with magic-link mail. |
| `CRON_SECRET` | 16+ characters. The scheduler sends `Authorization: Bearer $CRON_SECRET`. Unset means the route answers 503 to everything. |
| `AUTH_URL` | Origin used for the links in emails. |

### The scheduler

- **`vercel.json`** runs the route hourly on Vercel. On the Hobby plan Vercel runs crons at most once a day, so add the fallback below.
- **`.github/workflows/notifications.yml`** curls the route at :07 past every hour. It does nothing until the repository secrets `LEDGER_URL` and `CRON_SECRET` are set.
- **Running both is harmless**, because of the log rows.
- **Self-hosting:** any hourly `curl -H "Authorization: Bearer …" https://…/api/cron/notifications` works.

`/api/cron/` and `/api/notifications/unsubscribe` are in `isPublicPath`. Neither has a session: the secret and the HMAC signature are their whole authorization.

### Unsubscribe links

The link is `?u=<userId>&k=<kind>&s=<HMAC-SHA256(userId:kind)>`, keyed by a purpose-derived key from `AUTH_SECRET`.

- **They never expire.** A dead unsubscribe link is a spam complaint.
- **Rotating `AUTH_SECRET` invalidates them**, along with sessions.
- **A leaked link can only turn one kind of email off.**

## Tests

- **Unit:** `schedule.test.ts` covers the local hour, local date, the week boundaries and a DST week. `templates.test.ts` covers both languages and HTML escaping. `unsubscribe.test.ts` covers signature binding and secret rotation.
- **`notifications.db.test.ts`:** the route end to end with only `fetch` faked. It covers the auth gate, once per period across three runs, nothing claimed when there is nothing to say, a failed send not retried, the Monday summary, and the signed and tampered unsubscribe links.
- **`e2e/notifications.spec.ts`:** a trade raises the dashboard strip, the email switches render disabled without a provider, and the in-app switch turns the strip off.
