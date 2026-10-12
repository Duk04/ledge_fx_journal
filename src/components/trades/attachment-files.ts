/**
 * What the browser checks before an attachment upload, and the upload itself
 * — shared by the trade form (files picked before the trade exists) and the
 * uploader on a saved trade. The server re-checks everything
 * (app/api/attachments/route.ts sniffs the bytes); these exist so an obvious
 * mistake is reported before a slow upload, not after.
 */

export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/avif"];
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const ATTACHMENT_KINDS = ["BEFORE", "AFTER", "OTHER"] as const;
export type AttachmentKindName = (typeof ATTACHMENT_KINDS)[number];

/** A `trades.attachments` message key, or null when the file looks fine. */
export function validateImageFile(file: File): "unsupportedType" | "tooLarge" | null {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) return "unsupportedType";
  if (file.size > MAX_IMAGE_BYTES) return "tooLarge";
  return null;
}

/** Image files from a paste event — empty for text, so pasting into an
 * ordinary field is never intercepted. */
export function imagesFromClipboard(e: ClipboardEvent): File[] {
  const out: File[] = [];
  for (const item of e.clipboardData?.items ?? []) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) out.push(file);
    }
  }
  return out;
}

export type UploadResult<T> = { ok: true; row: T } | { ok: false; error: string | null; network: boolean };

/**
 * POSTs one file to /api/attachments. XHR rather than fetch for the upload
 * progress events. `error` is the server's message when it sent one; with
 * none, `network` tells a dropped connection from a refusal, and the caller
 * words each itself.
 */
export function uploadAttachment<T>(
  input: { tradeId: string; file: File; kind: AttachmentKindName; caption?: string },
  onProgress?: (percent: number) => void,
): Promise<UploadResult<T>> {
  return new Promise((resolve) => {
    const form = new FormData();
    form.set("tradeId", input.tradeId);
    form.set("file", input.file);
    form.set("kind", input.kind);
    if (input.caption) form.set("caption", input.caption);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/attachments");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* not JSON: handled as a failure below */
      }
      if (xhr.status >= 200 && xhr.status < 300 && body) resolve({ ok: true, row: body as T });
      else resolve({ ok: false, error: (body as { error?: string } | null)?.error ?? null, network: false });
    };
    xhr.onerror = () => resolve({ ok: false, error: null, network: true });
    xhr.send(form);
  });
}
