"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { fieldErrorsFrom, ok, type ActionResult } from "./result";
import { requireUser } from "@/lib/session";
import { getStorage } from "@/lib/storage";
import type { AttachmentTarget } from "@/lib/attachment-target";
import { findOwnedAttachment, resolveAttachmentOwner } from "./attachment-owner";
import { vmsg } from "@/i18n/encoded";
import { failT, failZod } from "@/i18n/server-t";

/**
 * Attachment writes that aren't "upload a file" (that one's a multipart
 * route handler — see src/app/api/attachments/route.ts, whose progress
 * reporting a server action can't match). Same result-object convention as
 * every other action module: return `{ ok, formError?, fieldErrors? }`
 * rather than throwing, since a thrown rejection has nothing to catch it on
 * the calling form's side.
 */

/**
 * Every action below finds its row through `./attachment-owner`, scoped to
 * the current user through whichever owner the attachment has — a trade's
 * account, or a journal entry (SCOPING RULE in lib/session.ts).
 */

// ---------------------------------------------------------------------------
// addExternalLink
// ---------------------------------------------------------------------------

const addExternalLinkSchema = z.object({
  target: z.union([z.object({ tradeId: z.string().min(1) }), z.object({ journalDate: z.string().min(1) })]),
  // https-only: an http:// screenshot link is either a mistake or something
  // that will start throwing mixed-content errors the moment this app is
  // served over TLS (which it always is outside local dev).
  url: z
    .string()
    .url()
    .refine((u) => u.startsWith("https://"), { message: vmsg("httpsUrl") }),
  kind: z.enum(["BEFORE", "AFTER", "OTHER"]).default("OTHER"),
  caption: z.string().max(500).optional(),
});

export async function addExternalLink(
  target: AttachmentTarget,
  url: string,
  kind: "BEFORE" | "AFTER" | "OTHER" = "OTHER",
  caption?: string,
): Promise<ActionResult<{ id: string }>> {
  const parsed = addExternalLinkSchema.safeParse({ target, url, kind, caption });
  if (!parsed.success) {
    return failZod(fieldErrorsFrom(parsed.error));
  }

  const user = await requireUser();
  const owner = await resolveAttachmentOwner(user.id, parsed.data.target);
  if (!owner) return failT("attachmentTargetNotFound");

  const row = await prisma.attachment.create({
    data: {
      ...owner.data,
      kind: parsed.data.kind,
      externalUrl: parsed.data.url,
      caption: parsed.data.caption?.trim() || null,
    },
  });

  revalidatePath(owner.path);
  return { ok: true, id: row.id };
}

// ---------------------------------------------------------------------------
// setCaption
// ---------------------------------------------------------------------------

const setCaptionSchema = z.object({
  attachmentId: z.string().min(1),
  caption: z.string().max(500).nullable(),
});

export async function setCaption(attachmentId: string, caption: string | null): Promise<ActionResult> {
  const parsed = setCaptionSchema.safeParse({ attachmentId, caption });
  if (!parsed.success) {
    return failZod(fieldErrorsFrom(parsed.error));
  }

  const user = await requireUser();
  const attachment = await findOwnedAttachment(user.id, parsed.data.attachmentId);
  if (!attachment) return failT("attachmentNotFound");

  const value = parsed.data.caption?.trim();
  await prisma.attachment.update({
    where: { id: attachment.id },
    data: { caption: value ? value : null },
  });

  revalidatePath(attachment.path);
  return ok();
}

// ---------------------------------------------------------------------------
// setKind — the Before/After toggle on a thumbnail
// ---------------------------------------------------------------------------

const setKindSchema = z.object({
  attachmentId: z.string().min(1),
  kind: z.enum(["BEFORE", "AFTER", "OTHER"]),
});

export async function setAttachmentKind(
  attachmentId: string,
  kind: "BEFORE" | "AFTER" | "OTHER",
): Promise<ActionResult> {
  const parsed = setKindSchema.safeParse({ attachmentId, kind });
  if (!parsed.success) {
    return failZod(fieldErrorsFrom(parsed.error));
  }

  const user = await requireUser();
  const attachment = await findOwnedAttachment(user.id, parsed.data.attachmentId);
  if (!attachment) return failT("attachmentNotFound");

  await prisma.attachment.update({ where: { id: attachment.id }, data: { kind: parsed.data.kind } });

  revalidatePath(attachment.path);
  return ok();
}

// ---------------------------------------------------------------------------
// deleteAttachment
// ---------------------------------------------------------------------------

export async function deleteAttachment(attachmentId: string): Promise<ActionResult> {
  if (!attachmentId) return failT("missingAttachmentId");

  const user = await requireUser();
  const attachment = await findOwnedAttachment(user.id, attachmentId);
  if (!attachment) return failT("attachmentNotFound");

  if (attachment.storageKey) {
    await getStorage().deleteObject(attachment.storageKey);
  }
  await prisma.attachment.delete({ where: { id: attachment.id } });

  revalidatePath(attachment.path);
  return ok();
}
