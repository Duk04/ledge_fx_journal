"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { fieldErrorsFrom, ok, type ActionResult } from "./result";
import { failZod } from "@/i18n/server-t";
import { vmsg } from "@/i18n/encoded";
import { isJournalDate, toEntryDate } from "@/lib/journal-date";

/**
 * Journal writes. See docs/JOURNAL.md for the autosave contract these back:
 * each Textarea saves its own field independently on blur, and the mood
 * selector saves immediately on change — there is no separate "save" button
 * and no "create entry" step, because the whole point of the day view is
 * that the form is always there, ready.
 */

// A real calendar day, not just the shape of one: "2026-13-01" passes a
// regex, becomes an Invalid Date and makes Prisma throw (lib/journal-date.ts).
const dateSchema = z.string().refine(isJournalDate, vmsg("invalidDate"));

function revalidateDay(date: string) {
  revalidatePath(`/journal/${date}`);
  revalidatePath("/journal");
}

const fieldInputSchema = z.object({
  date: dateSchema,
  field: z.enum(["preMarket", "review"]),
  value: z.string().max(20_000, vmsg("noteTooLong")),
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
    return failZod(fieldErrorsFrom(parsed.error));
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
    return failZod(fieldErrorsFrom(parsed.error));
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
