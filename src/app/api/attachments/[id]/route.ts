import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { getStorage } from "@/lib/storage";

/**
 * `GET`/`DELETE /api/attachments/[id]` — the only way a stored screenshot's
 * bytes ever reach a browser. Attachments live under `.uploads/` (or an S3
 * bucket), never `public/`, precisely so this ownership check runs on every
 * single fetch instead of being bypassable by guessing a URL.
 */

async function loadOwnedAttachment(id: string, userId: string) {
  return prisma.attachment.findFirst({
    where: { id, trade: { account: { userId } } },
    select: { id: true, tradeId: true, storageKey: true, externalUrl: true, mimeType: true },
  });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const attachment = await loadOwnedAttachment(id, user.id);
  if (!attachment) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  if (!attachment.storageKey) {
    // An external-link attachment has nothing of ours to stream — send the
    // browser straight to the URL that was recorded for it.
    if (attachment.externalUrl) {
      return NextResponse.redirect(attachment.externalUrl, 307);
    }
    return NextResponse.json({ error: "This attachment has no file." }, { status: 404 });
  }

  const object = await getStorage().getObject(attachment.storageKey);
  if (!object) {
    return NextResponse.json({ error: "The stored file is missing." }, { status: 404 });
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

  const attachment = await loadOwnedAttachment(id, user.id);
  if (!attachment) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  if (attachment.storageKey) {
    // Best-effort: an already-missing object shouldn't block deleting the
    // row (see local/S3 driver `deleteObject`, both tolerant of a missing key).
    await getStorage().deleteObject(attachment.storageKey);
  }
  await prisma.attachment.delete({ where: { id: attachment.id } });

  revalidatePath(`/trades/${attachment.tradeId}`);
  return NextResponse.json({ ok: true });
}
