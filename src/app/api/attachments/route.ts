import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import type { AttachmentKind } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { resolveAttachmentOwner } from "@/lib/actions/attachment-owner";
import { tr } from "@/i18n/server-t";
import {
  ALLOWED_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
  getStorage,
  makeAttachmentKey,
  sniffImage,
  uploadsAvailable,
} from "@/lib/storage";

/**
 * `POST /api/attachments` — multipart upload of a screenshot, onto a trade
 * (`tradeId`) or onto a day's journal entry (`journalDate`, YYYY-MM-DD).
 *
 * A plain route handler (not a server action) on purpose: the uploader
 * component drives this with `XMLHttpRequest` so it can show per-file
 * upload progress, which a server action's `fetch`-based transport can't
 * report.
 *
 * Every step re-derives trust from the signed-in user — the trade id or date
 * in the form body is never assumed to belong to them (see SCOPING RULE in
 * lib/session.ts, and actions/attachment-owner.ts for the two paths).
 */

const VALID_KINDS: readonly AttachmentKind[] = ["BEFORE", "AFTER", "OTHER"];

export async function POST(request: Request) {
  const user = await requireUser();
  if (!uploadsAvailable()) {
    return NextResponse.json({ error: await tr("uploadsNeedS3") }, { status: 503 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: await tr("expectedMultipart") }, { status: 400 });
  }

  const tradeId = form.get("tradeId");
  const journalDate = form.get("journalDate");
  const target =
    typeof tradeId === "string" && tradeId
      ? { tradeId }
      : typeof journalDate === "string" && journalDate
        ? { journalDate }
        : null;
  if (!target) {
    return NextResponse.json({ error: await tr("attachmentTargetMissing") }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: await tr("missingFile") }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: await tr("fileEmpty") }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: await tr("fileTooLarge", { mb: String(Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))) }) },
      { status: 413 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const sniffed = sniffImage(buffer);
  if (!sniffed) {
    return NextResponse.json(
      {
        error: await tr("unsupportedImageType", {
          formats: ALLOWED_IMAGE_TYPES.map((t) => t.split("/")[1]).join(", "),
        }),
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

  // Resolved only once the file has passed every check: for a journal day
  // this creates the day's entry, and a rejected file should not leave one.
  const owner = await resolveAttachmentOwner(user.id, target);
  if (!owner) {
    return NextResponse.json({ error: await tr("attachmentTargetNotFound") }, { status: 404 });
  }

  const key = makeAttachmentKey(user.id, owner.scope, sniffed.contentType);
  await getStorage().putObject({ key, body: buffer, contentType: sniffed.contentType });

  const row = await prisma.attachment.create({
    data: {
      ...owner.data,
      kind,
      storageKey: key,
      mimeType: sniffed.contentType,
      width: sniffed.width,
      height: sniffed.height,
      sizeBytes: buffer.length,
      caption,
    },
  });

  revalidatePath(owner.path);
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
