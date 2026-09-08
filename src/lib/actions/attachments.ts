"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { fail, failFields, fieldErrorsFrom, ok, type ActionResult } from "./result";
import { requireUser } from "@/lib/session";
import { getStorage } from "@/lib/storage";

/**
 * Attachment writes that aren't "upload a file" (that one's a multipart
 * route handler — see src/app/api/attachments/route.ts, whose progress
 * reporting a server action can't match). Same result-object convention as
 * every other action module: return `{ ok, formError?, fieldErrors? }`
 * rather than throwing, since a thrown rejection has nothing to catch it on
 * the calling form's side.
 */

/** Loads a trade scoped to the current user, or null. Every action below calls this before writing anything — see SCOPING RULE in lib/session.ts. */
async function ownedTrade(userId: string, tradeId: string) {
  return prisma.trade.findFirst({ where: { id: tradeId, account: { userId } }, select: { id: true } });
}

/** Loads an attachment scoped to the current user (through trade -> account), or null. */
async function ownedAttachment(userId: string, attachmentId: string) {
  return prisma.attachment.findFirst({
    where: { id: attachmentId, trade: { account: { userId } } },
    select: { id: true, tradeId: true, storageKey: true },
  });
}

function revalidateTrade(tradeId: string) {
  revalidatePath(`/trades/${tradeId}`);
}

// ---------------------------------------------------------------------------
// addExternalLink
// ---------------------------------------------------------------------------

const addExternalLinkSchema = z.object({
  tradeId: z.string().min(1),
  // https-only: an http:// screenshot link is either a mistake or something
  // that will start throwing mixed-content errors the moment this app is
  // served over TLS (which it always is outside local dev).
  url: z
    .string()
    .url()
    .refine((u) => u.startsWith("https://"), { message: "Must be an https:// URL." }),
  kind: z.enum(["BEFORE", "AFTER", "OTHER"]).default("OTHER"),
  caption: z.string().max(500).optional(),
});

export async function addExternalLink(
  tradeId: string,
  url: string,
  kind: "BEFORE" | "AFTER" | "OTHER" = "OTHER",
  caption?: string,
): Promise<ActionResult<{ id: string }>> {
  const parsed = addExternalLinkSchema.safeParse({ tradeId, url, kind, caption });
  if (!parsed.success) {
    return failFields(fieldErrorsFrom(parsed.error));
  }

  const user = await requireUser();
  const trade = await ownedTrade(user.id, parsed.data.tradeId);
  if (!trade) return fail("Trade not found.");

  const row = await prisma.attachment.create({
    data: {
      tradeId: trade.id,
      kind: parsed.data.kind,
      externalUrl: parsed.data.url,
      caption: parsed.data.caption?.trim() || null,
    },
  });

  revalidateTrade(trade.id);
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
    return failFields(fieldErrorsFrom(parsed.error));
  }

  const user = await requireUser();
  const attachment = await ownedAttachment(user.id, parsed.data.attachmentId);
  if (!attachment) return fail("Attachment not found.");

  const value = parsed.data.caption?.trim();
  await prisma.attachment.update({
    where: { id: attachment.id },
    data: { caption: value ? value : null },
  });

  revalidateTrade(attachment.tradeId);
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
    return failFields(fieldErrorsFrom(parsed.error));
  }

  const user = await requireUser();
  const attachment = await ownedAttachment(user.id, parsed.data.attachmentId);
  if (!attachment) return fail("Attachment not found.");

  await prisma.attachment.update({ where: { id: attachment.id }, data: { kind: parsed.data.kind } });

  revalidateTrade(attachment.tradeId);
  return ok();
}

// ---------------------------------------------------------------------------
// deleteAttachment
// ---------------------------------------------------------------------------

export async function deleteAttachment(attachmentId: string): Promise<ActionResult> {
  if (!attachmentId) return fail("Missing attachment id.");

  const user = await requireUser();
  const attachment = await ownedAttachment(user.id, attachmentId);
  if (!attachment) return fail("Attachment not found.");

  if (attachment.storageKey) {
    await getStorage().deleteObject(attachment.storageKey);
  }
  await prisma.attachment.delete({ where: { id: attachment.id } });

  revalidateTrade(attachment.tradeId);
  return ok();
}
