import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { AttachmentTarget } from "@/lib/attachment-target";
import { fromEntryDate, isJournalDate, toEntryDate } from "@/lib/journal-date";

/**
 * Who an attachment belongs to, in one place. An attachment hangs off a trade
 * OR a day's journal entry (schema.prisma, `Attachment`), so "is this the
 * caller's?" has two join paths — and every reader of a stored screenshot
 * (the upload and serve routes, the caption/kind/delete actions, account
 * deletion) has to ask it the same way. Written once here so that adding the
 * journal path could not leave one of them checking only the trade.
 *
 * Not a "use server" module: these trust their caller to have authenticated
 * (`requireUser()`), and take the user id it returned. They are helpers, not
 * endpoints (AGENTS.md, "Server actions").
 */

/** WHERE fragment: attachments the user owns, through either owner. */
export function attachmentOwnedBy(userId: string): Prisma.AttachmentWhereInput {
  return { OR: [{ trade: { account: { userId } } }, { journalEntry: { userId } }] };
}

/** The page that shows an attachment — what to revalidate after a change. */
function pathFor(row: { tradeId: string | null; journalEntry: { entryDate: Date } | null }): string {
  return row.journalEntry ? `/journal/${fromEntryDate(row.journalEntry.entryDate)}` : `/trades/${row.tradeId}`;
}

/** One attachment, if the user owns it; null otherwise — never a hint which. */
export async function findOwnedAttachment(userId: string, attachmentId: string) {
  const row = await prisma.attachment.findFirst({
    where: { id: attachmentId, ...attachmentOwnedBy(userId) },
    select: {
      id: true,
      tradeId: true,
      storageKey: true,
      externalUrl: true,
      mimeType: true,
      journalEntry: { select: { entryDate: true } },
    },
  });
  return row ? { ...row, path: pathFor(row) } : null;
}

export interface AttachmentOwner {
  /** The column that ties a new row to its owner. */
  data: { tradeId: string } | { journalEntryId: string };
  /** The storage-key segment under the user's own prefix. */
  scope: string;
  /** The page that shows it. */
  path: string;
}

/**
 * Resolves where a new attachment goes, re-deriving trust from `userId`: a
 * trade must belong to one of the user's accounts, and a journal day is
 * always the user's own — its entry is created if the day has none yet, the
 * same way the first keystroke of a plan creates it (actions/journal.ts).
 * Null for a trade that is not theirs or a day that is not a date.
 */
export async function resolveAttachmentOwner(
  userId: string,
  target: AttachmentTarget,
): Promise<AttachmentOwner | null> {
  if ("tradeId" in target) {
    const trade = await prisma.trade.findFirst({
      where: { id: target.tradeId, account: { userId } },
      select: { id: true },
    });
    return trade ? { data: { tradeId: trade.id }, scope: trade.id, path: `/trades/${trade.id}` } : null;
  }

  if (!isJournalDate(target.journalDate)) return null;
  const entryDate = toEntryDate(target.journalDate);
  const entry = await prisma.journalEntry.upsert({
    where: { userId_entryDate: { userId, entryDate } },
    update: {},
    create: { userId, entryDate },
    select: { id: true },
  });
  return {
    data: { journalEntryId: entry.id },
    scope: `journal/${target.journalDate}`,
    path: `/journal/${target.journalDate}`,
  };
}
