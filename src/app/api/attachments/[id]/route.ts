import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { getStorage } from "@/lib/storage";
import { findOwnedAttachment, revalidateAttachmentViews } from "@/lib/actions/attachment-owner";
import { tr } from "@/i18n/server-t";

/**
 * `GET`/`DELETE /api/attachments/[id]` — the only way a stored screenshot's
 * bytes ever reach a browser. Attachments live under `.uploads/` (or an S3
 * bucket), never `public/`, precisely so this ownership check runs on every
 * single fetch instead of being bypassable by guessing a URL. Ownership runs
 * through the trade's account or the journal entry, whichever the
 * attachment hangs off (actions/attachment-owner.ts).
 */

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const attachment = await findOwnedAttachment(user.id, id);
  if (!attachment) {
    return NextResponse.json({ error: await tr("attachmentNotFound") }, { status: 404 });
  }

  if (!attachment.storageKey) {
    // An external-link attachment has nothing of ours to stream — send the
    // browser straight to the URL that was recorded for it.
    if (attachment.externalUrl) {
      return NextResponse.redirect(attachment.externalUrl, 307);
    }
    return NextResponse.json({ error: await tr("attachmentNoFile") }, { status: 404 });
  }

  const object = await getStorage().getObject(attachment.storageKey);
  if (!object) {
    return NextResponse.json({ error: await tr("storedFileMissing") }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(object.body), {
    status: 200,
    headers: {
      "Content-Type": attachment.mimeType ?? "application/octet-stream",
      // Immutable: a given attachment id's bytes never change (a re-upload
      // creates a new attachment row), so the browser/CDN can cache forever.
      // `private` because this is a per-user file, not something a shared
      // cache should ever serve to a second user.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const attachment = await findOwnedAttachment(user.id, id);
  if (!attachment) {
    return NextResponse.json({ error: await tr("attachmentNotFound") }, { status: 404 });
  }

  if (attachment.storageKey) {
    // Best-effort: an already-missing object shouldn't block deleting the
    // row (see local/S3 driver `deleteObject`, both tolerant of a missing key).
    await getStorage().deleteObject(attachment.storageKey);
  }
  await prisma.attachment.delete({ where: { id: attachment.id } });

  revalidateAttachmentViews(attachment.path);
  return NextResponse.json({ ok: true });
}
