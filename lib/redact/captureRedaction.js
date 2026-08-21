// N00f — the capture-side half of "redact before upload" (D8).
//
// This module owns:
//   * where a redaction profile lives  (keyed on (user, institution) per capture surface)
//   * when a profile is missing or stale (which BLOCKS the upload and re-prompts)
//   * turning a picked File into a redacted Anthropic image block
//
// It never stores text. A profile is region geometry, an aspect ratio and a
// version — nothing that came out of the image.

import {
  RedactionError,
  assertGeometryOnly,
  assertRegionsCoverRequired,
  buildDocumentBlock,
  redactImageBlock,
} from "./imageRedactor";

/** Bump when the profile shape changes; every stored profile then re-prompts. */
export const REDACTION_PROFILE_VERSION = 1;

/** Capture surfaces that can send an image to /api/claude. */
export const REDACTION_SURFACES = { WORKLIST: "worklist", REPORT: "report" };

/** A screenshot whose shape differs from the tagged one by more than this re-prompts. */
export const ASPECT_TOLERANCE = 0.02;

// The vision API resizes above this anyway; shrink the payload here.
const MAX_EDGE = 1568;

/**
 * Per-user storage key. /api/store scopes every read and write to the signed-in
 * Clerk user id, so this key is (user, institution) for the given surface.
 */
export function redactionProfileKey(surface, institution) {
  return `nrv_redaction_profile_v${REDACTION_PROFILE_VERSION}:${surface}:${institution}`;
}

/** Build the persisted profile record. Geometry only. */
export function buildRedactionProfile({ surface, institution, regions, aspect, noPatientColumns = false }) {
  assertGeometryOnly(regions);
  assertRegionsCoverRequired(regions, { noPatientColumns });
  return {
    version: REDACTION_PROFILE_VERSION,
    surface,
    institution,
    aspect: round3(aspect),
    // A layout property, like the geometry beside it: this worklist has no
    // patient-name or MRN column. Stored on the profile so it inherits the
    // aspect staleness check — a differently shaped screenshot re-prompts
    // instead of silently inheriting somebody's earlier statement.
    noPatientColumns,
    regions: regions.map((r) => ({ id: r.id, x: round4(r.x), y: round4(r.y), w: round4(r.w), h: round4(r.h) })),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Is this profile usable for THIS scan?
 * Returns { ok: true } or { ok: false, reason } — the caller must block the
 * upload and re-prompt on anything that is not ok.
 */
export function profileStatus(profile, geometry) {
  if (!profile || typeof profile !== "object") return { ok: false, reason: "missing" };
  if (profile.version !== REDACTION_PROFILE_VERSION) return { ok: false, reason: "version" };
  try {
    assertGeometryOnly(profile.regions);
    assertRegionsCoverRequired(profile.regions, { noPatientColumns: profile.noPatientColumns === true });
  } catch (err) {
    return { ok: false, reason: err && err.code === "profile-incomplete" ? "incomplete" : "invalid" };
  }
  const aspect = geometry && Number(geometry.aspect);
  if (!Number.isFinite(aspect) || aspect <= 0) return { ok: false, reason: "unknown-geometry" };
  const stored = Number(profile.aspect);
  if (!Number.isFinite(stored) || stored <= 0) return { ok: false, reason: "invalid" };
  if (Math.abs(aspect - stored) / stored > ASPECT_TOLERANCE) return { ok: false, reason: "stale-geometry" };
  return { ok: true };
}

/** User-facing reason the upload was blocked. Never silent (INV-NO-SWALLOW). */
export function profileBlockMessage(reason, institution) {
  const where = institution ? ` for ${institution}` : "";
  if (reason === "stale-geometry")
    return `This screenshot has a different shape than the one you tagged${where}. Mark the patient-name and MRN columns again before it can be uploaded.`;
  if (reason === "version")
    return `Redaction was updated. Re-mark the patient-name and MRN columns${where} before uploading.`;
  if (reason === "incomplete" || reason === "invalid")
    return `The saved redaction profile${where} is unusable. Mark the patient-name and MRN columns again before uploading.`;
  if (reason === "unknown-geometry")
    return "That image could not be read on this device, so it cannot be redacted — and nothing is uploaded unredacted.";
  return `Before the first upload${where}, mark the patient-name and MRN columns so they never leave this device.`;
}

/**
 * Decode a picked file to a downscaled canvas, entirely on-device.
 * Throws instead of falling back to the raw file: an image we cannot decode is
 * an image we cannot redact, and an image we cannot redact is never sent.
 */
export async function decodeImageFile(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new RedactionError("image-undecodable", "That file could not be read."));
    reader.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new RedactionError("unsupported-format", "That image format cannot be read on this device."));
    im.src = dataUrl;
  });
  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new RedactionError("canvas-unavailable", "This browser cannot process images.");
  ctx.drawImage(img, 0, 0, width, height);
  return { canvas, width, height, aspect: width / height, dataUrl };
}

/** Geometry of a picked file, for the missing/stale profile check. */
export async function imageGeometry(file) {
  const decoded = await decodeImageFile(file);
  return { width: decoded.width, height: decoded.height, aspect: decoded.aspect };
}

/**
 * The one and only path from a picked file to something that can be uploaded.
 * A missing or stale profile throws — it never degrades to sending the original.
 */
export async function buildRedactedImageBlock(file, profile) {
  const decoded = await decodeImageFile(file);
  const status = profileStatus(profile, decoded);
  if (!status.ok) {
    const err = new RedactionError("redaction-profile-required", profileBlockMessage(status.reason, profile && profile.institution));
    err.reason = status.reason;
    throw err;
  }
  const ctx = decoded.canvas.getContext("2d");
  if (!ctx) throw new RedactionError("canvas-unavailable", "This browser cannot process images.");
  const bitmap = ctx.getImageData(0, 0, decoded.width, decoded.height);
  return redactImageBlock(bitmap, profile.regions, {
    mediaType: "image/jpeg",
    quality: 0.85,
    noPatientColumns: profile.noPatientColumns === true,
  });
}

/** Is this picked file a PDF report rather than a screenshot? */
export function isPdfFile(file) {
  return file && (file.type === "application/pdf" || /\.pdf$/i.test(file.name || ""));
}

/**
 * The one and only path from a picked PDF to something that can be uploaded.
 * A non-PDF never reaches here — it goes through buildRedactedImageBlock — and
 * buildDocumentBlock refuses any media type other than application/pdf, so this
 * cannot become a side door for an image.
 */
export async function buildDocumentAttachment(file) {
  if (!isPdfFile(file)) {
    throw new RedactionError(
      "unapproved-attachment",
      "Only a PDF may be attached as a document. Screenshots go through redaction.",
    );
  }
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      if (comma === -1) reject(new RedactionError("encode-failed", "That PDF could not be read."));
      else resolve(result.slice(comma + 1));
    };
    reader.onerror = () => reject(new RedactionError("encode-failed", "That PDF could not be read."));
    reader.readAsDataURL(file);
  });
  return buildDocumentBlock("application/pdf", base64);
}

function round3(n) {
  return Math.round(Number(n) * 1000) / 1000;
}
function round4(n) {
  return Math.round(Number(n) * 10000) / 10000;
}
