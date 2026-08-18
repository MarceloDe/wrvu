/**
 * N00f — destructive client-side image redaction (decision D8).
 *
 * Full worklist screenshots used to be POSTed to api.anthropic.com unredacted.
 * Every image that leaves this device now goes through `redactImage`, which
 * overwrites the masked pixels in the *encoded output*. There is no overlay and
 * no hidden layer: the bytes handed to the network no longer contain the pixels
 * that carried the patient name or the MRN.
 *
 * Nothing in this module ever reads, stores or transmits text. A redaction
 * profile is geometry only (INV-NO-PHI-IN-CLOUD).
 */

/** A masked rectangle, expressed as fractions (0..1) of the source image. */
export interface RedactionRegion {
  /** Which column this rectangle covers. Geometry label only — never content. */
  id: RedactionRegionId;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type RedactionRegionId = "name" | "mrn";

/** The region ids a profile must carry before any upload is allowed. */
export const REQUIRED_REGION_IDS: RedactionRegionId[] = ["name", "mrn"];

/** Every key a region is allowed to have. Anything else is rejected. */
const ALLOWED_REGION_KEYS = ["id", "x", "y", "w", "h"];

export interface PixelRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Anything we can turn into pixels: ImageData, ImageBitmap, <img>, <canvas>. */
export type RedactableBitmap =
  | ImageData
  | ImageBitmap
  | HTMLImageElement
  | HTMLCanvasElement;

export interface RedactOptions {
  mediaType?: "image/jpeg" | "image/png";
  quality?: number;
}

export interface AnthropicImageBlock {
  type: "image";
  source: { type: "base64"; media_type: string; data: string };
}

export class RedactionError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "RedactionError";
    this.code = code;
  }
}

/* ------------------------------------------------------------------ *
 * Geometry
 * ------------------------------------------------------------------ */

/**
 * Reject anything that is not pure geometry. This is the machine check behind
 * "the redaction profile stores geometry only — never any extracted text":
 * an unknown key, or an `id` outside the fixed enum, throws.
 */
export function assertGeometryOnly(regions: unknown): void {
  if (!Array.isArray(regions)) {
    throw new RedactionError("profile-invalid", "A redaction profile must be an array of regions.");
  }
  for (const region of regions) {
    if (!region || typeof region !== "object") {
      throw new RedactionError("profile-invalid", "A redaction region must be an object.");
    }
    const r = region as Record<string, unknown>;
    for (const key of Object.keys(r)) {
      if (!ALLOWED_REGION_KEYS.includes(key)) {
        throw new RedactionError(
          "profile-not-geometry",
          `A redaction region may only carry geometry (${ALLOWED_REGION_KEYS.join(", ")}); found "${key}".`,
        );
      }
    }
    if (r.id !== "name" && r.id !== "mrn") {
      throw new RedactionError("profile-not-geometry", 'A redaction region id must be "name" or "mrn".');
    }
    for (const key of ["x", "y", "w", "h"] as const) {
      const value = r[key];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new RedactionError("profile-invalid", `Redaction region ${key} must be a finite number.`);
      }
      if (value < 0 || value > 1) {
        throw new RedactionError("profile-invalid", `Redaction region ${key} must be a 0..1 fraction of the image.`);
      }
    }
    if ((r.w as number) <= 0 || (r.h as number) <= 0) {
      throw new RedactionError("profile-invalid", "A redaction region must have a positive width and height.");
    }
  }
}

/** Turn 0..1 fractions into integer pixel rectangles, clamped to the image. */
export function resolveRegions(
  regions: RedactionRegion[],
  width: number,
  height: number,
): PixelRect[] {
  const out: PixelRect[] = [];
  for (const region of regions) {
    const x0 = clampInt(Math.floor(region.x * width), 0, width);
    const y0 = clampInt(Math.floor(region.y * height), 0, height);
    const x1 = clampInt(Math.ceil((region.x + region.w) * width), 0, width);
    const y1 = clampInt(Math.ceil((region.y + region.h) * height), 0, height);
    if (x1 > x0 && y1 > y0) out.push({ id: region.id, x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }
  return out;
}

function clampInt(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

/* ------------------------------------------------------------------ *
 * Redaction
 * ------------------------------------------------------------------ */

/**
 * Overwrite `regions` with opaque black and re-encode.
 *
 * The returned Blob is a freshly encoded image whose masked pixels are gone —
 * not covered, not layered, not recoverable. The caller's bitmap is not mutated.
 */
export function redactImage(
  bitmap: RedactableBitmap,
  regions: RedactionRegion[],
  options: RedactOptions = {},
): Blob {
  return encodeRedacted(bitmap, regions, options).blob;
}

/**
 * The ONLY producer of an Anthropic image content block in this codebase.
 * Registers the block (and its encoded bytes) so `assertNoUnredactedImages` can
 * prove, at the network boundary, that what is about to be sent is redaction
 * output.
 */
export function redactImageBlock(
  bitmap: RedactableBitmap,
  regions: RedactionRegion[],
  options: RedactOptions = {},
): AnthropicImageBlock {
  const encoded = encodeRedacted(bitmap, regions, options);
  const block: AnthropicImageBlock = {
    type: "image",
    source: { type: "base64", media_type: encoded.mediaType, data: encoded.base64 },
  };
  markRedactedBlock(block);
  markRedactedPayload(encoded.base64);
  return block;
}

interface EncodedImage {
  blob: Blob;
  base64: string;
  mediaType: string;
}

function encodeRedacted(
  bitmap: RedactableBitmap,
  regions: RedactionRegion[],
  options: RedactOptions,
): EncodedImage {
  assertGeometryOnly(regions);
  const mediaType = options.mediaType || "image/jpeg";
  const quality = typeof options.quality === "number" ? options.quality : 0.85;

  const { width, height, pixels } = toPixels(bitmap);
  if (!width || !height) {
    throw new RedactionError("image-undecodable", "The image could not be decoded for redaction.");
  }
  for (const rect of resolveRegions(regions as RedactionRegion[], width, height)) {
    fillOpaqueBlack(pixels, width, rect);
  }

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new RedactionError("canvas-unavailable", "This browser cannot re-encode the redacted image.");
  ctx.putImageData(new ImageData(pixels, width, height), 0, 0);

  const dataUrl = canvas.toDataURL(mediaType, quality);
  const comma = dataUrl.indexOf(",");
  const base64 = comma === -1 ? "" : dataUrl.slice(comma + 1);
  if (!base64) throw new RedactionError("encode-failed", "The redacted image could not be encoded.");
  const actualMediaType = /^data:([^;,]+)/.exec(dataUrl)?.[1] || mediaType;
  return {
    blob: new Blob([base64ToBytes(base64)], { type: actualMediaType }),
    base64,
    mediaType: actualMediaType,
  };
}

/** Destroy the pixels: opaque black, written straight into the buffer. */
function fillOpaqueBlack(pixels: PixelBuffer, width: number, rect: PixelRect): void {
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    let index = (y * width + rect.x) * 4;
    for (let x = 0; x < rect.w; x++) {
      pixels[index] = 0;
      pixels[index + 1] = 0;
      pixels[index + 2] = 0;
      pixels[index + 3] = 255;
      index += 4;
    }
  }
}

/** RGBA buffer backed by a plain ArrayBuffer (keeps DOM typings happy). */
function allocPixels(length: number) {
  return new Uint8ClampedArray(new ArrayBuffer(length));
}
type PixelBuffer = ReturnType<typeof allocPixels>;

interface Pixels {
  width: number;
  height: number;
  pixels: PixelBuffer;
}

function toPixels(bitmap: RedactableBitmap): Pixels {
  const asImageData = bitmap as ImageData;
  if (asImageData && asImageData.data instanceof Uint8ClampedArray) {
    return {
      width: asImageData.width,
      height: asImageData.height,
      pixels: copyPixels(asImageData.data),
    };
  }
  const width = Math.round((bitmap as { width: number }).width);
  const height = Math.round((bitmap as { height: number }).height);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new RedactionError("canvas-unavailable", "This browser cannot read the image pixels.");
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height);
  return { width, height, pixels: copyPixels(data.data) };
}

function copyPixels(source: ArrayLike<number>): PixelBuffer {
  const out = allocPixels(source.length);
  out.set(source as unknown as ArrayLike<number>);
  return out;
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  if (typeof document === "undefined") {
    throw new RedactionError("canvas-unavailable", "Image redaction requires a browser canvas.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function base64ToBytes(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/* ------------------------------------------------------------------ *
 * Network-boundary guard
 * ------------------------------------------------------------------ */

/**
 * Provenance registry. The block objects themselves are held weakly, so a batch
 * of any size stays provable for as long as the caller holds it and nothing is
 * retained afterwards. The byte-level set is a bounded second witness for blocks
 * that were copied rather than passed through (structuredClone, JSON round-trip).
 *
 * Note the asymmetry that keeps this honest: forgetting a redacted payload can
 * only BLOCK an upload, never allow one.
 */
const REDACTED_PAYLOAD_LIMIT = 64;
let redactedBlocks = new WeakSet<object>();
const redactedPayloads = new Set<string>();

function markRedactedBlock(block: object): void {
  redactedBlocks.add(block);
}

function markRedactedPayload(base64: string): void {
  if (redactedPayloads.size >= REDACTED_PAYLOAD_LIMIT) {
    const oldest = redactedPayloads.values().next();
    if (!oldest.done) redactedPayloads.delete(oldest.value);
  }
  redactedPayloads.add(base64);
}

export function isRedactedPayload(base64: unknown): boolean {
  return typeof base64 === "string" && redactedPayloads.has(base64);
}

/** Test seam: forget every registered block and payload. */
export function resetRedactedPayloads(): void {
  redactedPayloads.clear();
  redactedBlocks = new WeakSet<object>();
}

interface ContentBlockLike {
  type?: string;
  source?: { media_type?: string; data?: unknown };
}

interface MessageLike {
  content?: string | ContentBlockLike[];
}

/**
 * Hard gate in front of /api/claude: any image-bearing block must be output of
 * `redactImageBlock`. An image assembled anywhere else throws instead of being
 * sent (INV-NO-SWALLOW: it surfaces, it is never dropped silently).
 */
export function assertNoUnredactedImages(messages: unknown): void {
  const list = Array.isArray(messages) ? (messages as MessageLike[]) : [];
  for (const message of list) {
    const content = message && message.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const isImage =
        block.type === "image" ||
        (block.type === "document" && String(block.source?.media_type || "").startsWith("image/"));
      if (!isImage) continue;
      if (!redactedBlocks.has(block) && !isRedactedPayload(block.source?.data)) {
        throw new RedactionError(
          "unredacted-image",
          "Blocked: an image that did not come from redactImage() cannot be uploaded.",
        );
      }
    }
  }
}
