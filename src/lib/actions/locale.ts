"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { isLocale } from "@/i18n/config";
import { setLocaleCookie } from "@/lib/locale-cookie";
import { failT } from "@/i18n/server-t";
import { ok, type ActionResult } from "./result";

/** Change the UI language: stored on the user (so it follows them to another
 * device at sign-in) and set as this browser's cookie (so it applies now). */
export async function setLocale(locale: string): Promise<ActionResult> {
  const user = await requireUser();
  if (!isLocale(locale)) return failT("unsupportedLanguage");
  await prisma.user.update({ where: { id: user.id }, data: { locale } });
  await setLocaleCookie(locale);
  revalidatePath("/", "layout");
  return ok();
}
