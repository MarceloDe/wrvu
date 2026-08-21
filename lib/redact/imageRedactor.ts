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

/**
 * Every region id must be present before an image block may be minted.
 * Without this, `redactImageBlock(bitmap, [])` would be a legal call that
 * registered an UNREDACTED image as approved — the exact hand-construction
 * bypass N00c contract 2 asks us to close.
 */
export function assertRegionsCoverRequired(
  regions: RedactionRegion[],
  opts: { noPatientColumns?: boolean } = {},
): void {
  // A capture with no patient-name and no MRN column to mark.
  //
  // This is the normal case now, not an edge case. Onboarding tells the
  // physician "Photograph only the procedure, site and date columns — never
  // include patient names, medical record numbers, dates of birth or accession
  // numbers", and the capture screen repeats it. A worklist captured that way
  // has nothing to mask, and demanding two boxes over columns that do not exist
  // left the upload permanently disabled: Save & redact greyed out, no way
  // forward. Following the instruction exactly made the feature unusable.
  //
  // The escape is an explicit statement by the person looking at the image, not
  // a default and not an inference — the app cannot see what a column contains.
  // It is stored on the profile and therefore inherits the aspect-ratio
  // staleness check, so a differently shaped screenshot re-prompts rather than
  // silently inheriting the attestation.
  //
  // It deliberately does NOT weaken the hand-construction bypass this function
  // exists to close: redactImageBlock(bitmap, []) with no attestation still
  // throws. Only an explicit noPatientColumns admits an unmasked image.
  if (opts.noPatientColumns) {
    if (regions.length) {
      throw new RedactionError(
        "profile-incomplete",
        "A capture declared free of patient columns cannot also carry mask regions.",
      );
    }
    return;
  }
  for (const id of REQUIRED_REGION_IDS) {
    if (!regions.some((r) => r && r.id === id)) {
      throw new RedactionError(
        "profile-incomplete",
        `Mark the ${id === "mrn" ? "MRN" : "patient name"} column before uploading.`,
      );
    }
  }
}

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
 * Registers the block (and its encoded bytes) so `assertNoUnredactedImages` and
 * `assertApprovedAttachments` can prove, at the network boundary, that what is
 * about to be sent is redaction output.
 *
 * The region set must cover every REQUIRED_REGION_ID: minting an approved block
 * from an empty or partial mask would be a bypass of the very guarantee the
 * registry exists to prove.
 */
export function redactImageBlock(
  bitmap: RedactableBitmap,
  regions: RedactionRegion[],
  options: RedactOptions & { noPatientColumns?: boolean } = {},
): AnthropicImageBlock {
  assertGeometryOnly(regions);
  assertRegionsCoverRequired(regions, { noPatientColumns: options.noPatientColumns });
  const encoded = encodeRedacted(bitmap, regions, options);
  const block: AnthropicImageBlock = {
    type: "image",
    source: { type: "base64", media_type: encoded.mediaType, data: encoded.base64 },
  };
  markApprovedAttachment(block);
  markRedactedPayload(encoded.base64);
  return block;
}

/** A non-image attachment. Today that is one thing only: a PDF report. */
export interface AnthropicDocumentBlock {
  type: "document";
  source: { type: "base64"; media_type: "application/pdf"; data: string };
}

/**
 * The ONLY producer of a non-image attachment. A PDF carries no pixels this
 * module can mask, so it is not "redacted" — it is *enumerated*: the user picks
 * a PDF report deliberately, and it is the single non-image media type the
 * attachment channel admits. Anything else, including a document block whose
 * media type is an image, is refused here rather than at the boundary.
 */
export function buildDocumentBlock(mediaType: string, base64: string): AnthropicDocumentBlock {
  if (mediaType !== "application/pdf") {
    throw new RedactionError(
      "unapproved-attachment",
      "Only a PDF may be attached as a document. An image must go through redaction.",
    );
  }
  if (typeof base64 !== "string" || !base64) {
    throw new RedactionError("encode-failed", "That document could not be encoded.");
  }
  const block: AnthropicDocumentBlock = {
    type: "document",
    source: { type: "base64", media_type: "application/pdf", data: base64 },
  };
  markApprovedAttachment(block);
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
let approvedAttachments = new WeakSet<object>();
const redactedPayloads = new Set<string>();

/**
 * Module-private ON PURPOSE. There is no exported way to put an object into the
 * registry: the only two doors are `redactImageBlock` (which destroys the
 * profiled pixels first) and `buildDocumentBlock` (which admits application/pdf
 * and nothing else). A caller who hand-builds an attachment cannot mark it,
 * cannot import a marker, and therefore cannot get it past the boundary.
 */
function markApprovedAttachment(block: object): void {
  approvedAttachments.add(block);
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
  approvedAttachments = new WeakSet<object>();
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
      if (!approvedAttachments.has(block) && !isRedactedPayload(block.source?.data)) {
        throw new RedactionError(
          "unredacted-image",
          "Blocked: an image that did not come from redactImage() cannot be uploaded.",
        );
      }
    }
  }
}

/**
 * The attachment-channel gate — the N00c replacement for "assertNoUnredactedImages
 * over a client-built messages array".
 *
 * callClaude() no longer sends messages; it sends `attachments`. This walks that
 * array and FAILS CLOSED: an attachment is admitted only if it is, by object
 * IDENTITY, something this module produced. Identity survives the signature
 * change because the client passes the producer's own objects through — it never
 * flattens them to strings, which is precisely the design the first N00c build
 * got wrong.
 *
 * Order of witnesses, strongest first:
 *   1. WeakSet identity — the object came out of redactImageBlock() or
 *      buildDocumentBlock() in this page session. Unforgeable: the marker is
 *      module-private.
 *   2. Byte-level witness (images only) — the exact base64 a redactImageBlock()
 *      call produced. This exists so a block that was structurally cloned by the
 *      framework is not falsely BLOCKED. It can only ever admit bytes that were
 *      themselves redaction output, so it cannot admit an unredacted image.
 *
 * Anything else — unmarked, unknown type, hand-built, or not an object at all —
 * throws. "I don't recognise this" resolves to refusal, never to pass.
 */
export function assertApprovedAttachments(attachments: unknown): void {
  if (!Array.isArray(attachments)) {
    throw new RedactionError(
      "unapproved-attachment",
      "Blocked: the attachment list is not an array, so its provenance cannot be proven.",
    );
  }
  for (const attachment of attachments) {
    if (!attachment || typeof attachment !== "object") {
      throw new RedactionError(
        "unapproved-attachment",
        "Blocked: an attachment that this device did not produce cannot be uploaded.",
      );
    }
    if (approvedAttachments.has(attachment as object)) continue;
    const block = attachment as ContentBlockLike;
    if (block.type === "image" && isRedactedPayload(block.source?.data)) continue;
    const looksLikeImage =
      block.type === "image" ||
      String(block.source?.media_type || "").startsWith("image/");
    throw new RedactionError(
      looksLikeImage ? "unredacted-image" : "unapproved-attachment",
      looksLikeImage
        ? "Blocked: an image that did not come from redactImage() cannot be uploaded."
        : "Blocked: an attachment that did not come from this device's redaction path cannot be uploaded.",
    );
  }
  // Second witness over the same objects, in the message shape the upload takes.
  // Redundant by construction — and kept, because a guard with two independent
  // reasons to refuse is what "fails closed" means.
  assertNoUnredactedImages([{ content: attachments as ContentBlockLike[] }]);
}
