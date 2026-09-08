"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { fail, failFields, fieldErrorsFrom, ok, type ActionResult } from "./result";

/**
 * Journal writes. See docs/JOURNAL.md for the autosave contract these back:
 * each Textarea saves its own field independently on blur, and the mood
 * selector saves immediately on change — there is no separate "save" button
 * and no "create entry" step, because the whole point of the day view is
 * that the form is always there, ready.
 */

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date.");

function toEntryDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function revalidateDay(date: string) {
  revalidatePath(`/journal/${date}`);
  revalidatePath("/journal");
}

const fieldInputSchema = z.object({
  date: dateSchema,
  field: z.enum(["preMarket", "review"]),
  value: z.string().max(20_000, "That note is too long."),
});

/**
 * Autosaves one field (pre-market plan or post-session review) of one day's
 * entry, upserting on (userId, entryDate) — the first save on a fresh day
 * creates the row, every save after that updates it. Returns the row's new
 * `updatedAt` so the editor can show "Saved HH:MM".
 */
export async function saveJournalEntry(
  input: z.infer<typeof fieldInputSchema>,
): Promise<ActionResult<{ savedAt: string }>> {
  const parsed = fieldInputSchema.safeParse(input);
  if (!parsed.success) {
    return failFields(fieldErrorsFrom(parsed.error));
  }

  const user = await requireUser();
  const entryDate = toEntryDate(parsed.data.date);
  const value = parsed.data.value.trim().length ? parsed.data.value : null;
  const data = parsed.data.field === "preMarket" ? { preMarket: value } : { review: value };

  const row = await prisma.journalEntry.upsert({
    where: { userId_entryDate: { userId: user.id, entryDate } },
    update: data,
    create: { userId: user.id, entryDate, ...data },
  });

  revalidateDay(parsed.data.date);
  return { ok: true, savedAt: row.updatedAt.toISOString() };
}

const moodInputSchema = z.object({
  date: dateSchema,
  mood: z.number().int().min(1).max(5).nullable(),
});

/** Saves the 1-5 mood immediately on change (Segmented has no separate submit). */
export async function setMood(input: z.infer<typeof moodInputSchema>): Promise<ActionResult> {
  const parsed = moodInputSchema.safeParse(input);
  if (!parsed.success) {
    return failFields(fieldErrorsFrom(parsed.error));
  }

  const user = await requireUser();
  const entryDate = toEntryDate(parsed.data.date);

  await prisma.journalEntry.upsert({
    where: { userId_entryDate: { userId: user.id, entryDate } },
    update: { mood: parsed.data.mood },
    create: { userId: user.id, entryDate, mood: parsed.data.mood },
  });

  revalidateDay(parsed.data.date);
  return ok();
}

/** Clears a day's entry entirely. `deleteMany` so an already-empty day is a no-op, not an error. */
export async function deleteEntry(date: string): Promise<ActionResult> {
  const parsed = dateSchema.safeParse(date);
  if (!parsed.success) {
    return fail("Invalid date.");
  }

  const user = await requireUser();
  const entryDate = toEntryDate(parsed.data);

  await prisma.journalEntry.deleteMany({ where: { userId: user.id, entryDate } });

  revalidateDay(parsed.data);
  return ok();
}
