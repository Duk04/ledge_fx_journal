"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { failZod } from "@/i18n/server-t";
import { vmsg } from "@/i18n/encoded";
import { fieldErrorsFrom, ok, type ActionResult } from "./result";

const prefsSchema = z.object({
  journalReminder: z.boolean(),
  weeklySummary: z.boolean(),
  sendHour: z.number().int().min(0, vmsg("hourRange")).max(23, vmsg("hourRange")),
  inAppReminder: z.boolean(),
});

/**
 * Saves the whole preference row. Each switch in the Notifications tab saves
 * on change with the full set, so there is no partial-update path for one
 * stale tab to overwrite another field with a default.
 */
export async function updateNotificationPrefs(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = prefsSchema.safeParse(input);
  if (!parsed.success) return failZod(fieldErrorsFrom(parsed.error));
  await prisma.notificationPrefs.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...parsed.data },
    update: parsed.data,
  });
  revalidatePath("/", "layout");
  return ok();
}
