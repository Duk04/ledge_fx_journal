import { NextResponse } from "next/server";
import type { AttachmentKind } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import {
  ALLOWED_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
  getStorage,
  makeAttachmentKey,
  sniffImage,
  uploadsAvailable,
} from "@/lib/storage";

/**
 * `POST /api/attachments` — multipart upload of a trade screenshot.
 *
 * A plain route handler (not a server action) on purpose: the uploader
 * component drives this with `XMLHttpRequest` so it can show per-file
 * upload progress, which a server action's `fetch`-based transport can't
 * report.
 *
 * Every step re-derives trust from the signed-in user — the trade id in the
 * form body is never assumed to belong to them (see SCOPING RULE in
 * lib/session.ts).
 */

const VALID_KINDS: readonly AttachmentKind[] = ["BEFORE", "AFTER", "OTHER"];

export async function POST(request: Request) {
  const user = await requireUser();
  if (!uploadsAvailable()) {
    return NextResponse.json(
      { error: "Screenshot uploads need S3 storage on this deployment (S3_BUCKET). Add the image as a link instead." },
      { status: 503 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data." }, { status: 400 });
  }

  const tradeId = form.get("tradeId");
  if (typeof tradeId !== "string" || !tradeId) {
    return NextResponse.json({ error: "Missing tradeId." }, { status: 400 });
  }

  // Ownership check: the trade must belong to an account owned by this user.
  // Joining through account rather than trusting tradeId is the whole point
  // — see SCOPING RULE in lib/session.ts.
  const trade = await prisma.trade.findFirst({
    where: { id: tradeId, account: { userId: user.id } },
    select: { id: true },
  });
  if (!trade) {
    return NextResponse.json({ error: "Trade not found." }, { status: 404 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file." }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "That file is empty." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `That file is too large — the limit is ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB.` },
      { status: 413 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const sniffed = sniffImage(buffer);
  if (!sniffed) {
    return NextResponse.json(
      {
        error: `Unsupported file type. Accepted formats: ${ALLOWED_IMAGE_TYPES.map((t) => t.split("/")[1]).join(", ")}.`,
      },
      { status: 400 },
    );
  }

  const kindRaw = form.get("kind");
  const kind: AttachmentKind =
    typeof kindRaw === "string" && VALID_KINDS.includes(kindRaw as AttachmentKind)
      ? (kindRaw as AttachmentKind)
      : "OTHER";
  const captionRaw = form.get("caption");
  const caption = typeof captionRaw === "string" && captionRaw.trim() ? captionRaw.trim().slice(0, 500) : null;

  const key = makeAttachmentKey(user.id, trade.id, sniffed.contentType);
  await getStorage().putObject({ key, body: buffer, contentType: sniffed.contentType });

  const row = await prisma.attachment.create({
    data: {
      tradeId: trade.id,
      kind,
      storageKey: key,
      mimeType: sniffed.contentType,
      width: sniffed.width,
      height: sniffed.height,
      sizeBytes: buffer.length,
      caption,
    },
  });

  return NextResponse.json(
    {
      id: row.id,
      tradeId: row.tradeId,
      kind: row.kind,
      storageKey: row.storageKey,
      externalUrl: row.externalUrl,
      mimeType: row.mimeType,
      width: row.width,
      height: row.height,
      sizeBytes: row.sizeBytes,
      caption: row.caption,
      createdAt: row.createdAt.toISOString(),
    },
    { status: 201 },
  );
}
