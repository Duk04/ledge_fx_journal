import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Attachment storage abstraction — one small interface, two drivers.
 *
 * WHY AN INTERFACE AT ALL: this app runs in a sandbox with no object storage
 * today, but a trade screenshot is exactly the kind of asset a real
 * deployment puts in S3 (or an S3-compatible bucket — R2, Backblaze, MinIO).
 * Routing every call through `getStorage()` means switching drivers is one
 * environment variable, not a rewrite of the upload route.
 *
 * DRIVER SELECTION: `local` (writes under `.uploads/` at the project root)
 * unless `S3_BUCKET` is set, in which case `s3` is used. See the two
 * `create*Driver()` functions below for what each one needs.
 */

// ---------------------------------------------------------------------------
// Validation: allowed image types, size limit, magic-byte sniffing
// ---------------------------------------------------------------------------

export type AllowedImageType = "image/png" | "image/jpeg" | "image/webp" | "image/avif";

export const ALLOWED_IMAGE_TYPES: readonly AllowedImageType[] = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
];

/** 8MB — a chart screenshot has no business being bigger than this. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

const EXTENSION_BY_TYPE: Record<AllowedImageType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/avif": "avif",
};

export function extensionForType(type: AllowedImageType): string {
  return EXTENSION_BY_TYPE[type];
}

export interface SniffedImage {
  contentType: AllowedImageType;
  width: number | null;
  height: number | null;
}

/**
 * Identifies the real image format from its magic bytes — never trust the
 * `Content-Type` a client declares, since it's just a string the browser
 * (or an attacker) chose. Returns null when the bytes don't match any of the
 * four types this app accepts, which the caller turns into a 400.
 *
 * Dimension parsing is best-effort: a format we can identify but can't (or
 * fail to) find a width/height for still uploads fine with null dimensions
 * rather than being rejected — the columns are nullable for exactly this.
 */
export function sniffImage(buf: Buffer): SniffedImage | null {
  if (isPng(buf)) return { contentType: "image/png", ...safely(() => pngDimensions(buf)) };
  if (isJpeg(buf)) return { contentType: "image/jpeg", ...safely(() => jpegDimensions(buf)) };
  if (isWebp(buf)) return { contentType: "image/webp", ...safely(() => webpDimensions(buf)) };
  if (isAvif(buf)) return { contentType: "image/avif", ...safely(() => avifDimensions(buf)) };
  return null;
}

function safely(fn: () => { width: number; height: number } | null): { width: number | null; height: number | null } {
  try {
    const r = fn();
    return r ?? { width: null, height: null };
  } catch {
    return { width: null, height: null };
  }
}

function isPng(buf: Buffer): boolean {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return buf.length >= 8 && sig.every((b, i) => buf[i] === b);
}

function pngDimensions(buf: Buffer): { width: number; height: number } | null {
  // 8-byte signature, then a 4-byte chunk length + "IHDR", then width/height
  // as two big-endian uint32s. Fixed offsets — IHDR is always the first chunk.
  if (buf.length < 24) return null;
  if (buf.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function isJpeg(buf: Buffer): boolean {
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

/** Walk JPEG markers looking for a Start-Of-Frame segment (SOFn), which carries the frame's height/width. */
function jpegDimensions(buf: Buffer): { width: number; height: number } | null {
  let offset = 2; // past the FFD8 SOI marker
  const SOF_MARKERS = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buf[offset + 1];
    // Standalone markers (no length field) — skip just the 2 marker bytes.
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const segmentLength = buf.readUInt16BE(offset + 2);
    if (SOF_MARKERS.has(marker)) {
      const height = buf.readUInt16BE(offset + 5);
      const width = buf.readUInt16BE(offset + 7);
      return { width, height };
    }
    offset += 2 + segmentLength;
  }
  return null;
}

function isWebp(buf: Buffer): boolean {
  return (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  );
}

function webpDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 30) return null;
  const fourCc = buf.toString("ascii", 12, 16);
  const dataStart = 20; // 12-byte RIFF header + 4-byte chunk fourCC + 4-byte chunk size

  if (fourCc === "VP8 ") {
    // Lossy: 3-byte frame tag, then a 3-byte start code (9d 01 2a), then two
    // 14-bit little-endian dimensions.
    const width = buf.readUInt16LE(dataStart + 6) & 0x3fff;
    const height = buf.readUInt16LE(dataStart + 8) & 0x3fff;
    return { width, height };
  }
  if (fourCc === "VP8L") {
    // Lossless: 1-byte signature (0x2f), then 4 bytes packing 14-bit
    // width-1 / height-1 (little-endian bit stream).
    const b0 = buf[dataStart + 1];
    const b1 = buf[dataStart + 2];
    const b2 = buf[dataStart + 3];
    const b3 = buf[dataStart + 4];
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return { width, height };
  }
  if (fourCc === "VP8X") {
    // Extended: 1 byte flags, 3 bytes reserved, then two 24-bit
    // little-endian (canvas width - 1) / (canvas height - 1).
    const width = 1 + (buf[dataStart + 4] | (buf[dataStart + 5] << 8) | (buf[dataStart + 6] << 16));
    const height = 1 + (buf[dataStart + 7] | (buf[dataStart + 8] << 8) | (buf[dataStart + 9] << 16));
    return { width, height };
  }
  return null;
}

function isAvif(buf: Buffer): boolean {
  if (buf.length < 12 || buf.toString("ascii", 4, 8) !== "ftyp") return false;
  const majorBrand = buf.toString("ascii", 8, 12);
  if (majorBrand === "avif" || majorBrand === "avis") return true;
  // Some encoders put "avif"/"avis" in the compatible-brands list instead of
  // as the major brand — scan the rest of the ftyp box (4 bytes per brand).
  const boxSize = buf.readUInt32BE(0);
  const scanEnd = Math.min(buf.length, boxSize || buf.length);
  for (let o = 16; o + 4 <= scanEnd; o += 4) {
    const brand = buf.toString("ascii", o, o + 4);
    if (brand === "avif" || brand === "avis") return true;
  }
  return false;
}

/**
 * Best-effort AVIF (ISO-BMFF) dimension lookup: recursively walk container
 * boxes down to `meta > iprp > ipco > ispe`, which stores width/height as
 * two big-endian uint32s after a 4-byte version/flags field. AVIF's box
 * structure is a small subset of the full ISO-BMFF/HEIF spec, so this is
 * deliberately narrow — it returns null (never throws) the moment anything
 * looks unexpected, and the caller treats that exactly like "couldn't tell".
 */
function avifDimensions(buf: Buffer): { width: number; height: number } | null {
  const meta = findBox(buf, "meta", 0, buf.length);
  if (!meta) return null;
  // A "meta" box has a 4-byte version/flags header before its children.
  const iprp = findBox(buf, "iprp", meta.start + 4, meta.end);
  if (!iprp) return null;
  const ipco = findBox(buf, "ipco", iprp.start, iprp.end);
  if (!ipco) return null;
  const ispe = findBox(buf, "ispe", ipco.start, ipco.end);
  if (!ispe) return null;
  const width = buf.readUInt32BE(ispe.start + 4);
  const height = buf.readUInt32BE(ispe.start + 8);
  return { width, height };
}

/** Finds the first top-level box with the given 4-char type within [from, to), returning its content range (after the 8-byte size+type header). */
function findBox(buf: Buffer, type: string, from: number, to: number): { start: number; end: number } | null {
  let offset = from;
  while (offset + 8 <= to) {
    const size = buf.readUInt32BE(offset);
    const boxType = buf.toString("ascii", offset + 4, offset + 8);
    if (size < 8 || offset + size > to) return null; // malformed — bail out rather than loop forever
    if (boxType === type) return { start: offset + 8, end: offset + size };
    offset += size;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Driver interface
// ---------------------------------------------------------------------------

export interface PutObjectInput {
  key: string;
  body: Buffer;
  contentType: string;
}

export interface StoredObject {
  body: Buffer;
  contentType: string;
}

export interface StorageDriver {
  readonly kind: "local" | "s3";
  putObject(input: PutObjectInput): Promise<void>;
  getObject(key: string): Promise<StoredObject | null>;
  deleteObject(key: string): Promise<void>;
  /**
   * A locator for the object, for logs/debugging only. Nothing in this app
   * hands this URL to a browser directly — every download goes through
   * `GET /api/attachments/[id]`, which re-checks ownership on every request.
   * A trade screenshot is private data; a durable public URL (signed or not)
   * would outlive that check.
   */
  objectUrl(key: string): string;
}

// ---------------------------------------------------------------------------
// Local driver — `.uploads/<userId>/<tradeId>/<uuid>.<ext>` under the repo root
// ---------------------------------------------------------------------------

function localRoot(): string {
  return path.join(process.cwd(), ".uploads");
}

function createLocalDriver(): StorageDriver {
  return {
    kind: "local",
    async putObject({ key, body }: PutObjectInput) {
      const dest = path.join(localRoot(), key);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, body);
    },
    async getObject(key) {
      try {
        const body = await fs.readFile(path.join(localRoot(), key));
        return { body, contentType: "application/octet-stream" }; // caller has the real type from the DB row
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
    },
    async deleteObject(key) {
      try {
        await fs.unlink(path.join(localRoot(), key));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    },
    objectUrl(key) {
      return `local://.uploads/${key}`;
    },
  };
}

// ---------------------------------------------------------------------------
// S3 driver — presigned PUT/GET/DELETE, signed by hand with node:crypto
// ---------------------------------------------------------------------------
//
// No @aws-sdk/client-s3 dependency: SigV4 query-string ("presigned URL")
// signing is a documented, finite algorithm — see
// https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
// — and implementing it directly keeps this a few hundred lines instead of a
// multi-megabyte dependency for four HTTP calls. Path-style addressing
// (`endpoint/bucket/key`) is used throughout because it's what every
// S3-compatible provider this app is likely to sit behind (R2, MinIO,
// Backblaze B2, DigitalOcean Spaces) supports uniformly; classic AWS S3
// buckets created before the 2020 path-style deprecation also still work
// this way.

interface S3Config {
  endpoint: string; // e.g. https://s3.us-east-1.amazonaws.com or a custom S3-compatible host
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

function s3Config(): S3Config {
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  const region = process.env.S3_REGION || "us-east-1";
  const endpoint = process.env.S3_ENDPOINT || `https://s3.${region}.amazonaws.com`;

  if (!bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "S3 storage is selected (S3_BUCKET is set) but S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY are missing. " +
        "Set S3_BUCKET, S3_REGION, S3_ENDPOINT (optional — defaults to AWS), S3_ACCESS_KEY_ID and " +
        "S3_SECRET_ACCESS_KEY, or unset S3_BUCKET to fall back to local disk storage.",
    );
  }
  return { endpoint, bucket, region, accessKeyId, secretAccessKey };
}

function hmac(key: crypto.BinaryLike, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data: string): string {
  return crypto.createHash("sha256").update(data, "utf8").digest("hex");
}

/** AWS's flavour of percent-encoding: RFC 3986 unreserved chars stay literal, everything else (including `/` when `encodeSlash`) is escaped as uppercase %XX. */
function awsEncode(value: string, encodeSlash = true): string {
  return encodeURIComponent(value)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%2F/g, encodeSlash ? "%2F" : "/");
}

function signingKey(secret: string, dateStamp: string, region: string): Buffer {
  const kDate = hmac(`AWS4${secret}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, "s3");
  return hmac(kService, "aws4_request");
}

function presignedUrl(cfg: S3Config, method: "GET" | "PUT" | "DELETE", key: string, expiresSeconds = 300): string {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]/g, "").replace(/\.\d{3}Z$/, "Z");
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const host = new URL(cfg.endpoint).host;
  const canonicalUri = `/${awsEncode(cfg.bucket, false)}/${key.split("/").map((s) => awsEncode(s, false)).join("/")}`;

  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${cfg.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresSeconds),
    "X-Amz-SignedHeaders": "host",
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${awsEncode(k)}=${awsEncode(query[k])}`)
    .join("&");

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    `host:${host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const signature = hmac(signingKey(cfg.secretAccessKey, dateStamp, cfg.region), stringToSign).toString("hex");

  return `${cfg.endpoint}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

function createS3Driver(): StorageDriver {
  return {
    kind: "s3",
    async putObject({ key, body, contentType }: PutObjectInput) {
      const cfg = s3Config();
      const url = presignedUrl(cfg, "PUT", key);
      const res = await fetch(url, { method: "PUT", body: new Uint8Array(body), headers: { "Content-Type": contentType } });
      if (!res.ok) {
        throw new Error(`S3 PUT failed (${res.status} ${res.statusText}) for key "${key}".`);
      }
    },
    async getObject(key) {
      const cfg = s3Config();
      const url = presignedUrl(cfg, "GET", key);
      const res = await fetch(url);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`S3 GET failed (${res.status} ${res.statusText}) for key "${key}".`);
      const body = Buffer.from(await res.arrayBuffer());
      const contentType = res.headers.get("content-type") ?? "application/octet-stream";
      return { body, contentType };
    },
    async deleteObject(key) {
      const cfg = s3Config();
      const url = presignedUrl(cfg, "DELETE", key);
      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        throw new Error(`S3 DELETE failed (${res.status} ${res.statusText}) for key "${key}".`);
      }
    },
    objectUrl(key) {
      const cfg = s3Config();
      return `${cfg.endpoint}/${cfg.bucket}/${key}`;
    },
  };
}

// ---------------------------------------------------------------------------
// Driver selection
// ---------------------------------------------------------------------------

let cachedDriver: StorageDriver | null = null;

/** The active storage driver — `s3` when `S3_BUCKET` is set, `local` otherwise. Cached for the life of the process; there's nothing about it that needs to change mid-request. */
export function getStorage(): StorageDriver {
  if (!cachedDriver) {
    cachedDriver = process.env.S3_BUCKET ? createS3Driver() : createLocalDriver();
  }
  return cachedDriver;
}

/** Builds the storage key a new attachment is written to. Not a full path — drivers decide their own root. */
export function makeAttachmentKey(userId: string, tradeId: string, contentType: AllowedImageType): string {
  return `${userId}/${tradeId}/${crypto.randomUUID()}.${extensionForType(contentType)}`;
}
