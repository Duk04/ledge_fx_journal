"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { parseExportFile } from "@/lib/export-schema";
import { failT, getServerT } from "@/i18n/server-t";
import { ok, type ActionResult } from "./result";
import { restoreInto, type RestoreSummary } from "./restore-store";

/**
 * Settings → Data → Restore: read a JSON export (`GET /api/export/data`) back
 * in, into the SIGNED-IN user, as new accounts. docs/JOURNAL.md, "Restore",
 * says what comes back and what is skipped; restore-store.ts has the rules
 * and their reasons.
 *
 * Only `restoreFromExport` is exported: every export of this module is a
 * POST endpoint (AGENTS.md), and the writer that takes a user id lives in
 * restore-store.ts, which is not.
 */

/** A real export is a few MB for years of trading. The cap is generous on
 * purpose, and is there so a wrong file (a video, a database dump) is refused
 * before it is read into memory and parsed. */
const MAX_RESTORE_MB = 20;
const MAX_RESTORE_BYTES = MAX_RESTORE_MB * 1024 * 1024;

/** Accounts label: 80 characters (actions/accounts.ts). */
const MAX_LABEL = 80;

export type { RestoreSummary };

export async function restoreFromExport(formData: FormData): Promise<ActionResult<RestoreSummary>> {
  const user = await requireUser();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return failT("chooseRestoreFile");
  if (file.size > MAX_RESTORE_BYTES) return failT("restoreFileTooLarge", { mb: String(MAX_RESTORE_MB) });

  let json: unknown;
  try {
    json = JSON.parse(await file.text());
  } catch {
    return failT("restoreNotJson");
  }

  const parsed = parseExportFile(json);
  if (!parsed.ok) {
    if (parsed.reason === "newerVersion") return failT("restoreNewerVersion");
    if (parsed.reason === "notAnExport") return failT("restoreNotAnExport");
    // The first problem only: a whole list of zod issues is noise to the
    // person reading it, and the path is enough to find the line.
    return failT("restoreInvalidFile", { where: parsed.issues[0] ?? "?" });
  }

  // Instrument is shared reference data: read unscoped, never written here.
  const symbols = new Set<string>();
  for (const a of parsed.data.accounts) for (const t of a.trades) symbols.add(t.symbol);
  for (const alias of parsed.data.symbolAliases) symbols.add(alias.symbol);
  const instruments = new Map(
    (await prisma.instrument.findMany({ where: { symbol: { in: [...symbols] } } })).map((i) => [i.symbol, i]),
  );

  // The suffix is stored in the reader's language, like any label they type.
  // It marks the copy so it is never mistaken for the account it came from.
  const t = await getServerT();
  const restoredLabel = (label: string) => {
    const full = t("settings.restore.labelSuffix", { label });
    if (full.length <= MAX_LABEL) return full;
    const room = MAX_LABEL - (full.length - label.length);
    return t("settings.restore.labelSuffix", { label: label.slice(0, Math.max(room, 1)).trimEnd() });
  };

  let summary: RestoreSummary;
  try {
    // ONE transaction for the whole file, so a failure at any row leaves
    // nothing behind. restore-store.ts writes set-based (a handful of
    // statements per table, whatever the file's size), which is what makes
    // that affordable; the raised timeout is headroom for a remote database,
    // not for a row-by-row loop.
    summary = await prisma.$transaction(
      (tx) => restoreInto(tx, { userId: user.id, file: parsed.data, instruments, restoredLabel }),
      { timeout: 120_000, maxWait: 10_000 },
    );
  } catch (err) {
    // Rolled back, so "nothing was imported" is true. Logged because the
    // cause (a value too large for its column, a lost connection) is not
    // something the message can name.
    console.error("restoreFromExport failed", err);
    return failT("restoreFailed");
  }

  revalidatePath("/", "layout");
  revalidatePath("/accounts");
  revalidatePath("/trades");
  revalidatePath("/journal");
  revalidatePath("/settings");
  return ok(summary);
}
