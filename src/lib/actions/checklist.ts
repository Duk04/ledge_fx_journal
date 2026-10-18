"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { checklistDate } from "@/lib/queries/checklist";
import { fieldErrorsFrom, ok, type ActionResult } from "./result";
import { failT, failZod } from "@/i18n/server-t";
import { vmsg } from "@/i18n/encoded";

/**
 * Daily checklist writes (docs/JOURNAL.md, "Daily checklist"). Every action
 * authenticates and scopes by `userId` — a checklist item id from the client
 * is only ever used together with `userId` in the WHERE clause, and a miss
 * reads as "not found", never as "not yours".
 */

const MAX_ITEMS = 30;
const MAX_TEXT = 200;

const textSchema = z
  .string()
  .trim()
  .min(1, vmsg("checklistTextRequired"))
  .max(MAX_TEXT, vmsg("checklistTextTooLong", { max: MAX_TEXT }));
const idSchema = z.string().min(1).max(64);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, vmsg("invalidDate"));

function revalidateJournal(date?: string) {
  revalidatePath("/journal");
  if (date) revalidatePath(`/journal/${date}`);
  else revalidatePath("/journal/[date]", "page");
}

/** The user's active items, in order — the list every write below edits. */
async function activeItems(userId: string) {
  return prisma.checklistItem.findMany({
    where: { userId, archivedAt: null },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, sortOrder: true },
  });
}

export async function addChecklistItem(input: { text: string }): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const parsed = z.object({ text: textSchema }).safeParse(input);
  if (!parsed.success) return failZod(fieldErrorsFrom(parsed.error));

  const items = await activeItems(user.id);
  if (items.length >= MAX_ITEMS) return failT("checklistFull", { max: MAX_ITEMS });

  const last = items[items.length - 1];
  const row = await prisma.checklistItem.create({
    data: { userId: user.id, text: parsed.data.text, sortOrder: (last?.sortOrder ?? -1) + 1 },
    select: { id: true },
  });
  revalidateJournal();
  return ok({ id: row.id });
}

export async function renameChecklistItem(input: { id: string; text: string }): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = z.object({ id: idSchema, text: textSchema }).safeParse(input);
  if (!parsed.success) return failZod(fieldErrorsFrom(parsed.error));

  const res = await prisma.checklistItem.updateMany({
    where: { id: parsed.data.id, userId: user.id, archivedAt: null },
    data: { text: parsed.data.text },
  });
  if (res.count === 0) return failT("checklistItemNotFound");
  revalidateJournal();
  return ok();
}

/**
 * Takes an item off the list. One that was ever ticked is archived rather
 * than deleted, so the days it was part of keep their record; one that never
 * was is simply deleted.
 */
export async function removeChecklistItem(input: { id: string }): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = z.object({ id: idSchema }).safeParse(input);
  if (!parsed.success) return failZod(fieldErrorsFrom(parsed.error));

  const item = await prisma.checklistItem.findFirst({
    where: { id: parsed.data.id, userId: user.id, archivedAt: null },
    select: { id: true, _count: { select: { checks: true } } },
  });
  if (!item) return failT("checklistItemNotFound");

  if (item._count.checks > 0) {
    await prisma.checklistItem.update({ where: { id: item.id }, data: { archivedAt: new Date() } });
  } else {
    await prisma.checklistItem.delete({ where: { id: item.id } });
  }
  revalidateJournal();
  return ok();
}

/** Swaps an item with its neighbour. Rewrites every active item's position
 * as 0..n-1 while at it, so gaps or ties left by earlier edits heal. */
export async function moveChecklistItem(input: { id: string; direction: "up" | "down" }): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = z.object({ id: idSchema, direction: z.enum(["up", "down"]) }).safeParse(input);
  if (!parsed.success) return failZod(fieldErrorsFrom(parsed.error));

  const items = await activeItems(user.id);
  const from = items.findIndex((i) => i.id === parsed.data.id);
  if (from === -1) return failT("checklistItemNotFound");
  const to = parsed.data.direction === "up" ? from - 1 : from + 1;
  if (to < 0 || to >= items.length) return ok();

  const order = items.map((i) => i.id);
  [order[from], order[to]] = [order[to], order[from]];
  await prisma.$transaction(
    order.map((id, sortOrder) =>
      prisma.checklistItem.updateMany({ where: { id, userId: user.id }, data: { sortOrder } }),
    ),
  );
  revalidateJournal();
  return ok();
}

/** Ticks or unticks one item for one day. Only an active item can change: an
 * archived one is shown on its old days as a record, not as a control. */
export async function setDailyCheck(input: { itemId: string; date: string; checked: boolean }): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = z.object({ itemId: idSchema, date: dateSchema, checked: z.boolean() }).safeParse(input);
  if (!parsed.success) return failZod(fieldErrorsFrom(parsed.error));

  const item = await prisma.checklistItem.findFirst({
    where: { id: parsed.data.itemId, userId: user.id, archivedAt: null },
    select: { id: true },
  });
  if (!item) return failT("checklistItemNotFound");

  const date = checklistDate(parsed.data.date);
  if (parsed.data.checked) {
    await prisma.dailyCheck.upsert({
      where: { itemId_date: { itemId: item.id, date } },
      update: {},
      create: { itemId: item.id, date },
    });
  } else {
    await prisma.dailyCheck.deleteMany({ where: { itemId: item.id, date } });
  }
  revalidateJournal(parsed.data.date);
  return ok();
}
