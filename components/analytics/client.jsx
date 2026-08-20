"use client";
// N06 — the dashboard's shared client layer: the display taxonomy, the price book hook,
// the /api/claude and /api/store callers, and the two functions that turn a failure into
// a sentence a radiologist can act on.
//
// This was interleaved with the views in components/NeuroRVU.jsx. It is infrastructure
// every tab needs, so extracting the views without extracting this first would only have
// moved the coupling around.
//
// INV-SERVER-PROMPTS is the reason callClaude lives here and takes a TEMPLATE id: the
// client cannot send a system prompt, a tool set or a token budget. INV-NO-SWALLOW is why
// loadKey returns { value, error } — a read that failed must never be indistinguishable
// from an empty one.
import { useState, useEffect } from "react";
import { TAXONOMY } from "@/lib/data/neuro-taxonomy.js";
import { assertApprovedAttachments } from "../../lib/redact/imageRedactor";
import { buildDocumentAttachment, buildRedactedImageBlock, isPdfFile } from "../../lib/redact/captureRedaction";

export const CODES = TAXONOMY;   // display taxonomy only — carries NO wRVU. See the price book below.

let priceBookPromise = null;   // one fetch per page load, shared by every caller
export function usePriceBook() {
  const [book, setBook] = useState({ byCpt: {}, release: null, loading: true, error: null });
  useEffect(() => {
    let alive = true;
    priceBookPromise = priceBookPromise || fetch("/api/reference/codes")
      .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))));
    priceBookPromise
      .then(d => { if (!alive) return;
        setBook({ byCpt: Object.fromEntries(d.codes.map(c => [c.cpt, c])), release: d.release, loading: false, error: null }); })
      .catch(e => { if (alive) setBook(b => ({ ...b, loading: false, error: e })); });
    return () => { alive = false; };
  }, []);
  return book;
}
export const MOD_COLORS = { CT:"#0d9488", MRI:"#6366f1", CTA:"#0891b2", MRA:"#7c3aed", "Add-on":"#64748b" };
export const codeByCpt = Object.fromEntries(CODES.map(c => [c.cpt.replace("+",""), c]));

// N00c — the client names a TEMPLATE and passes typed params plus attachments.
// It cannot send a system prompt, a tool set or a token budget: those are
// resolved server-side from lib/prompts/registry.js (INV-SERVER-PROMPTS).
//
// `attachments` are the content-block OBJECTS the redaction path produced, never
// flattened to strings — that is what keeps the WeakSet provenance registry able
// to recognise them by identity at this boundary (N00f/D8).
export async function callClaude(template, { params = {}, attachments = [] } = {}) {
  // N00f/D8 + N00c — last gate before the network. Every attachment must be
  // something lib/redact produced; an unrecognised one is refused, not sent.
  assertApprovedAttachments(attachments);
  // Calls our own server route, which holds the Anthropic key (never exposed to the browser).
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ template, params, attachments }),
  });
  let data = {};
  let readable = true;
  try { data = await res.json(); } catch { readable = false; }
  if (!res.ok) {
    // The server sends a generic code + correlation id — never vendor text.
    // ocrErrorMessage() turns the code into the specific guidance below.
    const err = new Error(`API ${res.status}`);
    err.status = res.status;
    err.code = data?.error?.code || (readable ? "" : "invalid_response");
    err.correlationId = data?.error?.correlationId || res.headers.get("x-correlation-id") || "";
    throw err;
  }
  if (!readable) {
    const err = new Error("API response was not JSON");
    err.status = res.status;
    err.code = "invalid_response";
    throw err;
  }
  return data;
}

/* ---------------------------- failure messages ----------------------------
   The API never tells the browser what went wrong internally — it sends
   { error: { code, correlationId } }. These two helpers turn that into a
   sentence the UI renders, keeping the correlation id so a user can quote it. */
export async function apiFailure(res, what) {
  let code = "";
  let ref = res.headers.get("x-correlation-id") || "";
  try {
    const body = await res.json();
    code = body?.error?.code || "";
    ref = body?.error?.correlationId || ref;
  } catch { code = code || ""; }
  const reason =
    res.status === 401 || code === "unauthorized" ? "your session expired — sign in again"
    : code === "storage_unavailable" ? "the database could not be reached"
    : res.status >= 500 ? "the server had a problem"
    : "the request was rejected";
  return `${what} — ${reason}.${ref ? ` (ref ${ref})` : ""}`;
}
export function networkFailure(what) {
  return `${what} — the server is unreachable. Check your connection and try again.`;
}
export const textOf = (d) => (d.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");

// N00f/D8 — images are no longer prepared for upload here. Every picked image
// goes through lib/redact/captureRedaction.buildRedactedImageBlock, which
// downscales, destroys the profiled regions and encodes the masked pixels. An
// image the browser cannot decode is BLOCKED, never sent raw as a fallback.

// Turn any OCR failure into a specific, actionable message for the user.
export function ocrErrorMessage(err) {
  const status = err?.status;
  const code = err?.code;
  const detail = String(err?.detail || err?.message || "").toLowerCase();
  // N00f/D8 first: these are CLIENT-side blocks that fire before anything is sent,
  // so they can never be confused with an upstream failure.
  // N00f/D8 — redaction refusals are surfaced verbatim: the upload was blocked
  // on purpose and the user has to know why (INV-NO-SWALLOW).
  if (err?.code === "redaction-profile-required" || err?.code === "profile-incomplete" || err?.code === "profile-not-geometry" || err?.code === "profile-invalid")
    return err.message;
  if (err?.code === "unredacted-image")
    return "Upload blocked: that image was not redacted. Nothing was sent. Re-mark the patient-name and MRN columns and try again.";
  if (err?.code === "unapproved-attachment")
    return "Upload blocked: that attachment did not come from this device's redaction path. Nothing was sent. Pick the file again with the uploader.";
  if (err?.code === "image-undecodable" || err?.code === "canvas-unavailable")
    return "That image couldn't be processed on this device, so it can't be redacted — and an unredacted image is never uploaded. Try a PNG/JPEG screenshot.";
  // N00d: server-classified upstream failures, each carrying a correlation id.
  const ref = err?.correlationId ? ` (ref ${err.correlationId})` : "";
  // The server classifies the upstream failure into one of these codes; the
  // wording below is the same guidance this function has always given.
  if (code === "upstream_payload_too_large")
    return "That image is too large. Crop tightly to the worklist, or upload a screenshot instead of a full-resolution photo." + ref;
  if (code === "upstream_rate_limited")
    return "Too many requests right now — wait a few seconds and try again." + ref;
  if (code === "upstream_overloaded")
    return "The AI service is momentarily busy — please retry in a few seconds." + ref;
  if (code === "upstream_timeout")
    return "That took too long — the photo may be too large or complex. Crop to just the worklist and retry." + ref;
  if (code === "upstream_invalid_image")
    return "The image couldn't be read. Use a clear PNG/JPEG screenshot of the worklist, or add exams manually." + ref;
  if (code === "unauthorized")
    return "Your session expired — sign in again and re-upload." + ref;
  if (code === "config_missing")
    return "Extraction is not configured on the server — tell the administrator." + ref;
  // N00c — the proxy's own limits. Both are OUR refusals, not the vendor's.
  if (code === "rate_limited")
    return "Too many uploads in a row — wait a few seconds and try again." + ref;
  if (code === "daily_cap_reached")
    return "You've reached today's AI usage limit. It resets at midnight UTC — add exams manually until then." + ref;
  if (code === "too_many_attachments")
    return "Too many files at once — upload up to 8 screenshots per batch." + ref;
  if (code === "attachment_too_large")
    return "That file is too large. Crop tightly to the worklist, or upload a screenshot instead of a full-resolution photo." + ref;
  if (code === "unsupported_media_type")
    return "That file type can't be read. Upload a PNG/JPEG screenshot, or a PDF for a monthly report." + ref;
  if (err?.code === "unsupported-format")
    return "That photo format isn't supported. On iPhone, take a screenshot of the worklist instead of a photo, or set Settings → Camera → Formats → “Most Compatible” (JPEG). PNG/JPEG work best.";
  if (status === 401 || status === 403)
    return "Your session expired — sign in again and re-upload.";
  if (status === 413 || detail.includes("too large") || detail.includes("exceeds") || detail.includes("image dimensions"))
    return "That image is too large. Crop tightly to the worklist, or upload a screenshot instead of a full-resolution photo.";
  if (status === 429)
    return "Too many requests right now — wait a few seconds and try again.";
  if (status === 529 || detail.includes("overloaded"))
    return "The AI service is momentarily busy — please retry in a few seconds.";
  if (status === 504 || status === 408 || detail.includes("timeout") || detail.includes("timed out"))
    return "That took too long — the photo may be too large or complex. Crop to just the worklist and retry.";
  if (detail.includes("media type") || detail.includes("invalid_request") || detail.includes("could not process image"))
    return "The image couldn't be read. Use a clear PNG/JPEG screenshot of the worklist, or add exams manually.";
  return "Extraction failed — the image may be blurry or low quality. Retake in good light, hold steady, and fill the frame with the worklist (or add exams manually)." + ref;
}

// Build the attachment for a monthly-report upload. Neither branch builds a
// content block here: a PDF goes through buildDocumentAttachment (the only
// producer of a non-image attachment) and an IMAGE goes through
// buildRedactedImageBlock (N00f/D8), so this surface needs a redaction profile.
// Both producers register what they return, which is how callClaude's gate
// recognises it. Used by the Timeline import.
export async function prepareDoc(file, profile) {
  if (isPdfFile(file)) return buildDocumentAttachment(file);
  return buildRedactedImageBlock(file, profile);
}

// Merge OCR'd monthly rows into the user's existing baseline (the per-user
// monthly database). Consolidation rules per the spec:
//   - key (YYYY-MM) is the insertion dimension.
//   - months not yet stored are ADDED.
//   - months already stored are kept; if an incoming value differs we flag a
//     DISCREPANCY (old vs new) and take the newer report's value.
//   - existing months absent from the new report are left untouched.
// Returns { merged, added, updated, unchanged, discrepancies, skipped }.
// consolidateBaseline, BASELINE_FIELDS and FIELD_LABEL now live in
// lib/analytics/baseline.js (N06b), under characterisation tests — the epsilons are the
// part N18 must not disturb while generalising institutions.

export const KEY_LABEL = { nrv_baseline: "reported baseline", nrv_settings: "settings", nrv_explorer: "saved date range" };
// Returns { value, error } — a read that failed is NEVER indistinguishable from
// an empty one, because the caller renders `error` (INV-NO-SWALLOW).
export async function loadKey(k, fb) {
  const what = `Couldn't load your ${KEY_LABEL[k] || k}`;
  try {
    const r = await fetch(`/api/store?key=${encodeURIComponent(k)}`);
    if (!r.ok) return { value: fb, error: await apiFailure(r, what) };
    const j = await r.json();
    return { value: j && j.value != null ? j.value : fb, error: "" };
  } catch { return { value: fb, error: networkFailure(what) }; }
}
// Returns "" when the write landed, otherwise the sentence to show the user.
export async function saveKey(k, v) {
  const what = `Couldn't save your ${KEY_LABEL[k] || k}`;
  try {
    const r = await fetch("/api/store", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: k, value: v }),
    });
    if (!r.ok) return await apiFailure(r, what);
    return "";
  } catch { return networkFailure(what); }
}
