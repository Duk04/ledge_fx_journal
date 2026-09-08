import { describe, expect, it } from "vitest";
import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES, extensionForType, makeAttachmentKey, sniffImage } from "./storage";

/**
 * `sniffImage` is the upload validator on an app with open registration, so
 * it is the one function here whose failure mode is a stored file that is not
 * what it claims to be. Its own doc states the rule: never trust the
 * Content-Type a client declares, because it is a string the client chose.
 *
 * Everything below builds byte buffers rather than reading fixtures, so what
 * each test asserts about the format is visible in the test itself.
 *
 * Only the pure half of the module is covered. The drivers do filesystem and
 * S3 I/O and need the database-backed suite this repo does not have yet.
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A minimal but structurally real PNG: signature, then an IHDR chunk. */
function png(width = 800, height = 600): Buffer {
  const buf = Buffer.alloc(24);
  Buffer.from(PNG_SIGNATURE).copy(buf, 0);
  buf.writeUInt32BE(13, 8); // IHDR chunk length
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

/** A JPEG with an SOF0 frame header carrying the dimensions. */
function jpeg(width = 1920, height = 1080): Buffer {
  const parts: number[] = [0xff, 0xd8, 0xff];
  // APP0/JFIF segment, so the marker walk has something to skip over first.
  parts.push(0xe0, 0x00, 0x10);
  parts.push(...Array(14).fill(0x00));
  // SOF0: marker, length, precision, height, width, components.
  parts.push(0xff, 0xc0, 0x00, 0x11, 0x08);
  parts.push((height >> 8) & 0xff, height & 0xff);
  parts.push((width >> 8) & 0xff, width & 0xff);
  parts.push(0x03);
  parts.push(...Array(9).fill(0x00));
  return Buffer.from(parts);
}

/** A WebP: RIFF container with a WEBP fourcc and a VP8 chunk. */
function webp(width = 640, height = 480): Buffer {
  const buf = Buffer.alloc(30);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(22, 4);
  buf.write("WEBP", 8, "ascii");
  buf.write("VP8 ", 12, "ascii");
  buf.writeUInt32LE(10, 16);
  // VP8 keyframe: 3-byte tag, 3-byte start code, then 14-bit dimensions.
  buf.writeUInt8(0x9d, 23);
  buf.writeUInt8(0x01, 24);
  buf.writeUInt8(0x2a, 25);
  buf.writeUInt16LE(width, 26);
  buf.writeUInt16LE(height, 28);
  return buf;
}

/** An AVIF: ISO-BMFF ftyp box declaring the avif brand. */
function avif(): Buffer {
  const buf = Buffer.alloc(32);
  buf.writeUInt32BE(24, 0);
  buf.write("ftyp", 4, "ascii");
  buf.write("avif", 8, "ascii");
  buf.writeUInt32BE(0, 12);
  buf.write("avifmif1", 16, "ascii");
  return buf;
}

describe("sniffImage", () => {
  describe("identifies the four accepted formats", () => {
    it("reads a PNG and its dimensions", () => {
      expect(sniffImage(png(800, 600))).toEqual({ contentType: "image/png", width: 800, height: 600 });
    });

    it("reads a JPEG and its dimensions", () => {
      const result = sniffImage(jpeg(1920, 1080));
      expect(result?.contentType).toBe("image/jpeg");
      expect(result?.width).toBe(1920);
      expect(result?.height).toBe(1080);
    });

    it("reads a WebP", () => {
      expect(sniffImage(webp())?.contentType).toBe("image/webp");
    });

    it("reads an AVIF", () => {
      expect(sniffImage(avif())?.contentType).toBe("image/avif");
    });

    it("covers every type in ALLOWED_IMAGE_TYPES", () => {
      // If a fifth type is added to the allowlist, this fails until the
      // sniffer can actually recognise it — an allowlisted type the sniffer
      // rejects is an upload that mysteriously 400s.
      const sniffed = [png(), jpeg(), webp(), avif()].map((b) => sniffImage(b)?.contentType);
      expect(new Set(sniffed)).toEqual(new Set(ALLOWED_IMAGE_TYPES));
    });
  });

  describe("rejects anything else, whatever it claims to be", () => {
    it("rejects a GIF", () => {
      expect(sniffImage(Buffer.from("GIF89a\x01\x00\x01\x00", "binary"))).toBeNull();
    });

    it("rejects an SVG, which is a script-execution vector", () => {
      expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))).toBeNull();
    });

    it("rejects a PHP file with an image extension", () => {
      expect(sniffImage(Buffer.from('<?php system($_GET["c"]); ?>'))).toBeNull();
    });

    it("rejects HTML", () => {
      expect(sniffImage(Buffer.from("<!doctype html><script>alert(1)</script>"))).toBeNull();
    });

    it("rejects an ELF binary", () => {
      expect(sniffImage(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]))).toBeNull();
    });

    it("rejects a ZIP, which is what a docx or a jar is", () => {
      expect(sniffImage(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]))).toBeNull();
    });

    it("rejects a PDF", () => {
      expect(sniffImage(Buffer.from("%PDF-1.7\n"))).toBeNull();
    });
  });

  describe("truncated and malformed input", () => {
    it("rejects an empty buffer", () => {
      expect(sniffImage(Buffer.alloc(0))).toBeNull();
    });

    it("rejects a partial PNG signature", () => {
      expect(sniffImage(Buffer.from(PNG_SIGNATURE.slice(0, 4)))).toBeNull();
    });

    it("accepts a PNG signature with no IHDR, reporting null dimensions", () => {
      // The documented contract: a format we can identify but cannot measure
      // still uploads, because the width/height columns are nullable for
      // exactly this. It must not throw and must not be rejected.
      const result = sniffImage(Buffer.from(PNG_SIGNATURE));
      expect(result).toEqual({ contentType: "image/png", width: null, height: null });
    });

    it("accepts a JPEG with no SOF segment, reporting null dimensions", () => {
      const result = sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]));
      expect(result?.contentType).toBe("image/jpeg");
      expect(result?.width).toBeNull();
    });

    it("does not throw on a PNG whose IHDR is cut short", () => {
      const buf = png().subarray(0, 20);
      expect(() => sniffImage(buf)).not.toThrow();
    });

    it("does not throw on random bytes", () => {
      const random = Buffer.from(Array.from({ length: 256 }, (_, i) => (i * 37) % 256));
      expect(() => sniffImage(random)).not.toThrow();
    });
  });

  describe("polyglots — a real signature with a payload appended", () => {
    it("identifies a PNG with a script trailer as a PNG", () => {
      // This is the correct answer, and worth pinning: the bytes ARE a PNG.
      // What keeps it harmless is that attachments are served from an
      // authenticated route with the sniffed content type, never executed —
      // so identification, not rejection, is the sniffer's job.
      const polyglot = Buffer.concat([png(), Buffer.from("<script>alert(1)</script>")]);
      expect(sniffImage(polyglot)?.contentType).toBe("image/png");
    });

    it("rejects a script with a PNG signature further in", () => {
      // The signature has to be at offset 0. A file that only contains PNG
      // bytes somewhere in the middle is not a PNG.
      const disguised = Buffer.concat([Buffer.from("<?php ?>"), png()]);
      expect(sniffImage(disguised)).toBeNull();
    });
  });

  describe("dimensions", () => {
    it("reads large dimensions without overflowing", () => {
      expect(sniffImage(png(30_000, 20_000))).toMatchObject({ width: 30_000, height: 20_000 });
    });

    it("reads a 1x1 pixel image", () => {
      expect(sniffImage(png(1, 1))).toMatchObject({ width: 1, height: 1 });
    });
  });
});

describe("extensionForType", () => {
  it.each([
    ["image/png", "png"],
    ["image/jpeg", "jpg"],
    ["image/webp", "webp"],
    ["image/avif", "avif"],
  ] as const)("%s -> .%s", (type, extension) => {
    expect(extensionForType(type)).toBe(extension);
  });

  it("returns an extension for every allowed type", () => {
    for (const type of ALLOWED_IMAGE_TYPES) {
      expect(extensionForType(type), type).toMatch(/^[a-z]{3,4}$/);
    }
  });
});

describe("makeAttachmentKey", () => {
  it("namespaces by user and trade", () => {
    const key = makeAttachmentKey("user-1", "trade-2", "image/png");
    expect(key.startsWith("user-1/trade-2/")).toBe(true);
    expect(key.endsWith(".png")).toBe(true);
  });

  it("uses a server-generated uuid for the filename, never client input", () => {
    const key = makeAttachmentKey("user-1", "trade-2", "image/jpeg");
    const filename = key.split("/").pop() ?? "";
    expect(filename).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/);
  });

  it("is unique per call, so two uploads cannot collide", () => {
    const keys = new Set(Array.from({ length: 50 }, () => makeAttachmentKey("u", "t", "image/png")));
    expect(keys.size).toBe(50);
  });

  it("produces no traversal segment even from hostile ids", () => {
    // The ids come from the session and the database rather than the client,
    // so this is defence in depth — but the key is joined onto a filesystem
    // root by the local driver, so a `..` reaching it would matter.
    const key = makeAttachmentKey("../../etc", "../passwd", "image/png");
    const generatedSegment = key.split("/").pop() ?? "";
    expect(generatedSegment).not.toContain("..");
    // And the caller-supplied parts are passed through verbatim, which is why
    // they must never come from a request body:
    expect(key).toContain("..");
  });
});

describe("MAX_UPLOAD_BYTES", () => {
  it("is 8MB", () => {
    expect(MAX_UPLOAD_BYTES).toBe(8 * 1024 * 1024);
  });
});
