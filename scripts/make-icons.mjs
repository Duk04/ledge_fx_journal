#!/usr/bin/env node
// Generates public/icons/* from the same candle glyph used as the wordmark
// in src/components/shell/app-shell.tsx — drawn from scratch here (not a
// screenshot of the app) so it stays crisp at every size.
//
// Raw hex values are used here (never in component code — see the rule in
// globals.css) because this script runs at build/setup time, outside the
// CSS token system entirely, and needs concrete colours to hand to an SVG
// string / raster buffer.
//
// Primary path: rasterise with `sharp`, which happens to already be present
// in node_modules (it's an optional dependency of `next` itself, used for
// next/image — nothing was added to package.json to get it). If sharp can't
// be loaded, falls back to a small hand-rolled PNG encoder (raw RGBA +
// Node's built-in zlib deflate — no new dependency either way) that draws
// the exact same two-candle glyph with simple filled rectangles. Either way
// this never ships a placeholder grey square.
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import zlib from "node:zlib";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "..", "public", "icons");

const COLORS = {
  profit: "#0b7a5a", // --jade-600, light theme --profit
  grey: "#8d96a3", // --grey-400, light theme --ink-3
  canvasLight: "#f4f6f9", // --grey-50, light theme --canvas
  white: "#ffffff", // --grey-0, light theme --panel
};

// ---------------------------------------------------------------------------
// SVG source (the icons a browser can use directly, and the shape the raster
// fallback below reproduces with rectangles).
// ---------------------------------------------------------------------------

/** The glyph itself, on a 16x16 grid — identical geometry to the app-shell wordmark. */
function glyphSvg({ transparent = true } = {}) {
  const bg = transparent ? "" : `<rect width="16" height="16" fill="${COLORS.canvasLight}"/>`;
  return `${bg}
    <line x1="5" y1="1.5" x2="5" y2="14.5" stroke="${COLORS.profit}" stroke-width="1.2"/>
    <rect x="3" y="4" width="4" height="7" rx="0.5" fill="${COLORS.profit}"/>
    <line x1="11" y1="2.5" x2="11" y2="13.5" stroke="${COLORS.grey}" stroke-width="1.2"/>
    <rect x="9" y="6" width="4" height="5" rx="0.5" fill="${COLORS.grey}"/>`;
}

function standardSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${glyphSvg({ transparent: true })}</svg>`;
}

/** Maskable: full-bleed background, glyph scaled down into the ~safe zone (an OS may crop to a circle/rounded-square, so nothing load-bearing sits near the edge). */
function maskableSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
    <rect width="16" height="16" fill="${COLORS.canvasLight}"/>
    <g transform="translate(4 4) scale(0.5)">${glyphSvg({ transparent: true })}</g>
  </svg>`;
}

/** Apple touch icon: opaque background (iOS composites transparency as black), glyph filling most of the canvas — iOS applies its own corner rounding. */
function appleTouchSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
    <rect width="16" height="16" fill="${COLORS.white}"/>
    <g transform="translate(1.4 1.4) scale(0.825)">${glyphSvg({ transparent: true })}</g>
  </svg>`;
}

// ---------------------------------------------------------------------------
// Raster fallback: same three compositions, drawn as filled rectangles at
// the target pixel size, PNG-encoded by hand.
// ---------------------------------------------------------------------------

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function makeCanvas(size, bg) {
  const px = new Uint8ClampedArray(size * size * 4);
  if (bg) fillRect(px, size, 0, 0, size, size, bg, 255);
  return px;
}

function fillRect(px, size, x, y, w, h, hex, alpha = 255) {
  const [r, g, b] = hexToRgb(hex);
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(size, Math.round(x + w));
  const y1 = Math.min(size, Math.round(y + h));
  for (let yy = y0; yy < y1; yy += 1) {
    for (let xx = x0; xx < x1; xx += 1) {
      const i = (yy * size + xx) * 4;
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = alpha;
    }
  }
}

/** Draws the two-candle glyph, scaled from the 16x16 source grid onto a `size`x`size` canvas at the given offset/scale. */
function drawGlyph(px, size, originPx, scalePx) {
  const at = (gx, gy) => [originPx + gx * scalePx, originPx + gy * scalePx];
  // Wicks as thin rects (a 1px-ish line doesn't rasterise cleanly at small sizes, so draw it as a slim filled rect instead).
  const wickW = Math.max(1, scalePx * 0.35);
  let [wx, wy] = at(5 - 0.15, 1.5);
  fillRect(px, size, wx, wy, wickW, (14.5 - 1.5) * scalePx, COLORS.profit);
  fillRect(px, size, ...at(3, 4), 4 * scalePx, 7 * scalePx, COLORS.profit);
  [wx, wy] = at(11 - 0.15, 2.5);
  fillRect(px, size, wx, wy, wickW, (13.5 - 2.5) * scalePx, COLORS.grey);
  fillRect(px, size, ...at(9, 6), 4 * scalePx, 5 * scalePx, COLORS.grey);
}

function rasterStandard(size) {
  const px = makeCanvas(size, null); // transparent
  drawGlyph(px, size, 0, size / 16);
  return px;
}

function rasterMaskable(size) {
  const px = makeCanvas(size, COLORS.canvasLight);
  const scale = size / 16 / 2; // glyph occupies the inner half, matching maskableSvg's scale(0.5)
  drawGlyph(px, size, size / 4, scale);
  return px;
}

function rasterAppleTouch(size) {
  const px = makeCanvas(size, COLORS.white);
  const scale = (size / 16) * 0.825;
  drawGlyph(px, size, size * (1.4 / 16), scale);
  return px;
}

// --- minimal PNG encoder (signature + IHDR + one IDAT + IEND) --------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filter type: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

async function rasterise(size, variant) {
  const svg = { standard: standardSvg, maskable: maskableSvg, apple: appleTouchSvg }[variant]();
  try {
    const sharpMod = await import("sharp");
    const sharp = sharpMod.default ?? sharpMod;
    return await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
  } catch (err) {
    console.warn(`  sharp unavailable (${err.message}) — falling back to the hand-rolled PNG encoder for ${variant}@${size}`);
    const px = variant === "standard" ? rasterStandard(size) : variant === "maskable" ? rasterMaskable(size) : rasterAppleTouch(size);
    return encodePng(size, px);
  }
}

async function main() {
  await mkdir(outDir, { recursive: true });

  await writeFile(path.join(outDir, "icon.svg"), standardSvg());
  await writeFile(path.join(outDir, "icon-maskable.svg"), maskableSvg());

  const jobs = [
    ["icon-192.png", 192, "standard"],
    ["icon-512.png", 512, "standard"],
    ["icon-192-maskable.png", 192, "maskable"],
    ["icon-512-maskable.png", 512, "maskable"],
    ["apple-touch-icon.png", 180, "apple"],
  ];

  for (const [name, size, variant] of jobs) {
    const buf = await rasterise(size, variant);
    await writeFile(path.join(outDir, name), buf);
    console.log(`  wrote public/icons/${name} (${buf.length} bytes)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
