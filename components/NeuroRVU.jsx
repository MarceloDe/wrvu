"use client";
import React, { useState, useEffect, useMemo, useRef } from "react";
import { TAXONOMY } from "@/lib/data/neuro-taxonomy.js";
import { consolidateBaseline, BASELINE_FIELDS, FIELD_LABEL } from "@/lib/analytics/baseline.js";
import { num, fmt, monthKey, pad2, localDay, localMonth, daysAgo, MONTH_LABEL, weekStartKey, WEEK_LABEL } from "@/lib/analytics/format.js";
import { classifyInstitution, instMeta, DEFAULT_INSTITUTIONS } from "@/lib/analytics/institutions.js";
import { buildTimeline } from "@/lib/analytics/timeline.js";
import { buildAnalytics, buildRange } from "@/lib/analytics/tracked.js";
import {
  Brain, Activity, Upload, Camera, Search, Settings as SettingsIcon, Plus, Trash2,
  TrendingUp, TrendingDown, Loader2, Sparkles, X, FileImage, Calendar,
  Target, DollarSign, Database, Zap, Check, Building2, Layers, AlertTriangle,
  LineChart as LineIcon, CheckCircle2, Info, RotateCcw
} from "lucide-react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, Cell, PieChart, Pie
} from "recharts";
// N00c/INV-SERVER-PROMPTS — prompts are NOT imported here any more. The system
// prompt, the tool set and the token ceiling are server-owned and reachable only
// by naming a template id through /api/claude.
import { assertApprovedAttachments } from "../lib/redact/imageRedactor";
import {
  REDACTION_SURFACES, buildDocumentAttachment, buildRedactedImageBlock, buildRedactionProfile,
  imageGeometry, isPdfFile, profileBlockMessage, profileStatus, redactionProfileKey,
} from "../lib/redact/captureRedaction";
import RedactionTagger from "./RedactionTagger";

/* ============================================================================
   NEURORADIOLOGY CPT REFERENCE — CMS 2026 professional-component work RVU
   ========================================================================== */
const CODES = TAXONOMY;   // display taxonomy only — carries NO wRVU. See the price book below.

// THE PRICE BOOK. Every wRVU shown in this component comes from here, which comes from
// /api/reference/codes, which comes from the CMS reference schema. This file used to
// carry its own 61-code table with prices baked in — duplicated a third time in
// lib/data — and it disagreed with CMS on 54 of 61 codes, so the same study was worth
// one number on the phone and another in the browser.
//
// workRvu is null where CMS publishes no national value. Render that as "not priced",
// never as 0: 0 in a total is a claim, and it is the wrong one.
// The user's institutions. Falls back to the built-in UM/JHS/Other when the API returns
// nothing, so someone who has never opened Settings still gets a working dashboard —
// INV-SITE-NEVER-FAILS applies to a brand-new account too.
let institutionsPromise = null;
function useInstitutions() {
  const [state, setState] = useState({ institutions: null, siteOverrides: {}, loading: true });
  // Bumping this busts the module-level cache after a save, so the dashboard reflects a
  // renamed institution immediately instead of on the next full page load.
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    institutionsPromise = institutionsPromise || fetch("/api/institutions").then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))));
    institutionsPromise
      .then(d => { if (!alive) return;
        const list = (d.institutions || []).map(i => ({
          key: i.name, label: i.label, short: i.shortLabel, color: i.color,
          ytd: i.ytdWrvu, isDefault: i.isDefault, examCount: i.examCount ?? 0,
          // Patterns stay in code for the seeded three; a user-created institution is
          // matched by its explicit site mappings, not by a regex nobody wrote.
          prefix: DEFAULT_INSTITUTIONS.find(d => d.key === i.name)?.prefix,
          match: DEFAULT_INSTITUTIONS.find(d => d.key === i.name)?.match ?? null,
        }));
        setState({ institutions: list.length ? list : null, siteOverrides: d.siteOverrides || {}, loading: false });
      })
      .catch(() => { if (alive) setState(s => ({ ...s, loading: false })); });
    return () => { alive = false; };
  }, [nonce]);
  return { ...state, reload: () => { institutionsPromise = null; setNonce(n => n + 1); } };
}

let priceBookPromise = null;   // one fetch per page load, shared by every caller
function usePriceBook() {
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
const MOD_COLORS = { CT:"#0d9488", MRI:"#6366f1", CTA:"#0891b2", MRA:"#7c3aed", "Add-on":"#64748b" };
const codeByCpt = Object.fromEntries(CODES.map(c => [c.cpt.replace("+",""), c]));

/* ============================== INSTITUTION LOOP ============================== */
// INSTITUTIONS, classifyInstitution and instMeta now live in
// lib/analytics/institutions.js (N06) — the module N18 replaces.
function migrateLog(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(s => ({ ...s, items: (s.items || []).map(i => ({
    ...i, inst: classifyInstitution(i.inst), mod: i.mod || (codeByCpt[String(i.cpt).replace("+", "")]?.mod) || "Other",
  })) }));
}

/* ============================== BASELINE ==============================
   No seed data. Each user's reported baseline starts EMPTY and is stored
   per-user in the database (/api/store, scoped to the Clerk user id). Users
   build their own months in the Timeline tab; nothing is shared across users. */

const DEFAULTS = { ratePerWrvu: 78, cFTE: 1.0, monthlyBenchmark: 578, privateMult: 1.6, umYTD: 0, jhsYTD: 0 };

/* ============================== API ============================== */
// N00c — the client names a TEMPLATE and passes typed params plus attachments.
// It cannot send a system prompt, a tool set or a token budget: those are
// resolved server-side from lib/prompts/registry.js (INV-SERVER-PROMPTS).
//
// `attachments` are the content-block OBJECTS the redaction path produced, never
// flattened to strings — that is what keeps the WeakSet provenance registry able
// to recognise them by identity at this boundary (N00f/D8).
async function callClaude(template, { params = {}, attachments = [] } = {}) {
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
async function apiFailure(res, what) {
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
function networkFailure(what) {
  return `${what} — the server is unreachable. Check your connection and try again.`;
}
const textOf = (d) => (d.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");

// N00f/D8 — images are no longer prepared for upload here. Every picked image
// goes through lib/redact/captureRedaction.buildRedactedImageBlock, which
// downscales, destroys the profiled regions and encodes the masked pixels. An
// image the browser cannot decode is BLOCKED, never sent raw as a fallback.

// Turn any OCR failure into a specific, actionable message for the user.
function ocrErrorMessage(err) {
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
async function prepareDoc(file, profile) {
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

/* ============================== STORAGE ============================== */
const KEY_LABEL = { nrv_baseline: "reported baseline", nrv_settings: "settings", nrv_explorer: "saved date range" };
// Returns { value, error } — a read that failed is NEVER indistinguishable from
// an empty one, because the caller renders `error` (INV-NO-SWALLOW).
async function loadKey(k, fb) {
  const what = `Couldn't load your ${KEY_LABEL[k] || k}`;
  try {
    const r = await fetch(`/api/store?key=${encodeURIComponent(k)}`);
    if (!r.ok) return { value: fb, error: await apiFailure(r, what) };
    const j = await r.json();
    return { value: j && j.value != null ? j.value : fb, error: "" };
  } catch { return { value: fb, error: networkFailure(what) }; }
}
// Returns "" when the write landed, otherwise the sentence to show the user.
async function saveKey(k, v) {
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

/* ============================== HELPERS ============================== */
// "Now" must key off the user's LOCAL calendar (e.g. Miami/Eastern), not UTC.
// new Date().toISOString() is UTC, so near a month boundary it flips "this
// month" / the default exam date hours early (June 30 8pm ET = July 1 UTC).
// Stored exam dates keep their own value — this only affects today/this-month.
// Monday-start week key for a "YYYY-MM-DD" day (built from local parts, so no
// UTC drift). Returns the Monday's own "YYYY-MM-DD".

// Bucket the tracked exam log into weekly/monthly rows within [start, end]
// (inclusive, YYYY-MM-DD strings compare lexicographically) and derive range
// stats. Benchmark is scaled per bucket: monthly = target, weekly = target×12/52.

/* ============================== EXTRA DUTY ==============================
   Extra-duty work is paid separately from the monthly wRVU target/flow and is
   stored as AGGREGATE bundle records (extra_duty_periods) — never as `exams`
   rows — so none of the wRVU analytics above are affected. Two pay models:
     - per_diem: flat $ per shift.
     - ppc (pay-per-click): $ per exam by modality bucket (MRI / CT / XR). */
// Map a worklist modality onto a PPC pay bucket.
//
// This function was always right: an unrecognised modality falls to "other", which is
// NOT paid. The bug was upstream — every call site defaulted an unknown modality to
// "CT" before it got here, so nothing was ever unrecognised and every unknown study was
// paid at the CT rate. The reference schema knows the modality for all 828 codes,
// including 236 XR, so nothing has to be guessed any more. Unknown now means unknown.
const PPC_BUCKET = (mod) => {
  const m = String(mod || "").toUpperCase();
  if (m.includes("MR")) return "mri";                        // MRI, MRA
  if (m.includes("CT")) return "ct";                         // CT, CTA
  if (/XR|CR|DX|X-?RAY|RADIOGRAPH/.test(m)) return "xr";
  return "other";                                            // US, NM, Add-on… (not paid)
};
function bucketCounts(items) {
  const c = { mri: 0, ct: 0, xr: 0, other: 0 };
  for (const i of items || []) c[PPC_BUCKET(i.mod)] += (i.count || 1);
  return c;
}
// Bucket extra-duty periods by week/month within [start, end] and total the
// snapshotted dollars. Pure summation — no rate lookup, no double-count.
function buildExtraDuty(periods, start, end, gran) {
  const buckets = {};
  let total = 0, perDiem = 0, ppc = 0, exams = 0;
  const inRange = [];
  for (const p of periods || []) {
    const day = String(p.bundleDate).slice(0, 10);
    if (!day || (start && day < start) || (end && day > end)) continue;
    inRange.push(p);
    const amt = Number(p.amount) || 0;
    total += amt; exams += Number(p.examCount) || 0;
    if (p.payModel === "ppc") ppc += amt; else perDiem += amt;
    const k = gran === "week" ? weekStartKey(day) : day.slice(0, 7);
    buckets[k] = (buckets[k] || 0) + amt;
  }
  const rows = Object.keys(buckets).sort().map((k) => ({
    key: k, label: gran === "week" ? WEEK_LABEL(k) : MONTH_LABEL(k), amount: Math.round(buckets[k]),
  }));
  return {
    rows, total: Math.round(total), perDiem: Math.round(perDiem), ppc: Math.round(ppc), exams,
    periods: inRange.sort((a, b) => String(b.bundleDate).localeCompare(String(a.bundleDate))),
  };
}

/* ============================================================================ ROOT ============================================================================ */
const TABS = [
  { id: "tracker", label: "Tracker", icon: Activity },
  { id: "timeline", label: "Timeline", icon: LineIcon },
  { id: "exams", label: "Exams", icon: Layers },
  { id: "uploads", label: "Uploads", icon: Upload },
  { id: "reference", label: "Codes", icon: Database },
];

export default function NeuroRVU() {
  const [tab, setTab] = useState("tracker");
  const [exams, setExams] = useState([]);
  const [baseline, setBaseline] = useState([]);
  const [settings, setSettings] = useState(DEFAULTS);
  const inst = useInstitutions();
  // Injected, not stored. Every builder reads settings.institutions, so threading them
  // here means no call site changes and nothing can forget to pass them.
  // Returns null on success, or a message the drawer shows without closing. The server
  // is the authority on whether a set is valid (one default, unique names, no removal
  // that would orphan exams), so its message is surfaced verbatim rather than guessed at.
  const saveInstitutions = async (institutions, siteOverrides) => {
    try {
      const r = await fetch("/api/institutions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ institutions, siteOverrides }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => null);
        const code = body?.error?.code;
        // The envelope is `{error:{code,correlationId}}` and nothing else, so the wording
        // lives here. The correlation id is shown because it is the only thing that ties
        // what the user saw to the server log.
        const why = code === "validation_failed"
          ? "That set was rejected: it needs exactly one default institution, unique names, and no institution removed while exams still point at it."
          : code === "unauthorized" ? "Your session expired — sign in again."
          : `Could not save institutions (${r.status}).`;
        return body?.error?.correlationId ? `${why} (ref ${body.error.correlationId.slice(0, 8)})` : why;
      }
      inst.reload();
      return null;
    } catch {
      return networkFailure("save your institutions");
    }
  };
  const settingsWithInstitutions = useMemo(
    () => (inst.institutions
      ? {
          ...settings,
          institutions: inst.institutions,
          siteOverrides: inst.siteOverrides,
          // The YTD figures now live on the institution rows. umYTD/jhsYTD stay in
          // settings as the fallback for an account with no rows yet, but once rows
          // exist they are what the reported split is computed from.
          ytdByInstitution: Object.fromEntries(inst.institutions.map((i) => [i.key, Number(i.ytd) || 0])),
        }
      : settings),
    [settings, inst.institutions, inst.siteOverrides],
  );
  const [ready, setReady] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // Extra-duty (paid separately from the wRVU target): aggregate period records
  // + the user's pay rates. Both live in dedicated DB tables, per Clerk user.
  const [extraPeriods, setExtraPeriods] = useState([]);
  const [extraRates, setExtraRates] = useState({ perDiemRate: 0, ppcMri: 0, ppcCt: 0, ppcXr: 0 });
  // Tracked-explorer range (Timeline tab) lives here — the Timeline component
  // unmounts on tab switch, so its selection must be lifted + persisted per user.
  const [explorer, setExplorer] = useState({ gran: "week", start: "", end: "" });
  // Any failed read/write against the API lands here and is rendered as a
  // banner — a lost save is never silent (INV-NO-SWALLOW).
  const [syncError, setSyncError] = useState("");

  // Exams are the source of truth (dedicated DB table), loaded per Clerk user.
  async function reloadExams() {
    try {
      const r = await fetch("/api/exams");
      if (!r.ok) { setSyncError(await apiFailure(r, "Couldn't load your exams")); return; }
      const j = await r.json();
      setExams(Array.isArray(j.exams) ? j.exams : []);
      setSyncError("");
    } catch { setSyncError(networkFailure("Couldn't load your exams")); }
  }

  async function reloadExtra() {
    try {
      const [pr, rr] = await Promise.all([fetch("/api/extra-duty"), fetch("/api/extra-duty/rates")]);
      if (!pr.ok) { setSyncError(await apiFailure(pr, "Couldn't load your extra-duty shifts")); return; }
      const j = await pr.json();
      setExtraPeriods(Array.isArray(j.periods) ? j.periods : []);
      if (!rr.ok) { setSyncError(await apiFailure(rr, "Couldn't load your extra-duty pay rates")); return; }
      const jr = await rr.json();
      if (jr.rates) setExtraRates(jr.rates);
      setSyncError("");
    } catch { setSyncError(networkFailure("Couldn't load your extra-duty data")); }
  }

  async function saveExtraRates(next) {
    setExtraRates(next);
    try {
      const r = await fetch("/api/extra-duty/rates", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next),
      });
      if (!r.ok) { setSyncError(await apiFailure(r, "Couldn't save your extra-duty pay rates")); return; }
      setSyncError("");
    } catch { setSyncError(networkFailure("Couldn't save your extra-duty pay rates")); }
  }

  useEffect(() => {
    (async () => {
      await reloadExams();
      await reloadExtra();
      const loadErrors = [];
      const bl = await loadKey("nrv_baseline", null);
      if (bl.error) loadErrors.push(bl.error);
      // Per-user only: load this user's saved baseline, otherwise start EMPTY.
      // No shared seed — a new user's timeline reflects only their own entries.
      setBaseline(Array.isArray(bl.value) ? bl.value : []);
      const st = await loadKey("nrv_settings", DEFAULTS);
      if (st.error) loadErrors.push(st.error);
      setSettings({ ...DEFAULTS, ...(st.value || {}) });
      const ex = await loadKey("nrv_explorer", null);
      if (ex.error) loadErrors.push(ex.error);
      if (ex.value && typeof ex.value === "object") setExplorer({ gran: ex.value.gran === "month" ? "month" : "week", start: ex.value.start || "", end: ex.value.end || "" });
      if (loadErrors.length) setSyncError((prev) => prev || loadErrors[0]);
      setReady(true);
    })();
  }, []);

  // Adapter: feed the existing per-month analytics/timeline/exams views from the
  // exams table. Each exam becomes a single-item "session" keyed by ITS OWN exam
  // date, so everything visualizes exams-per-date with zero churn downstream.
  const log = useMemo(() => exams.map((e) => ({
    id: e.id, batchId: e.batchId,
    date: (e.examDate ? String(e.examDate) : String(e.uploadedAt || "")).slice(0, 10),
    items: [{
      uid: e.id, cpt: e.cpt || "?", desc: e.procedure || "Study", mod: e.modality || "Other",
      count: 1, wrvu: Number(e.wrvu) || 0, est: !!e.estimated,
      inst: e.institution || classifyInstitution(e.site),
    }],
  })), [exams]);

  // saveKey resolves to "" on success or a sentence on failure — either way the
  // banner reflects the true state of the write.
  const updateBaseline = (n) => { setBaseline(n); saveKey("nrv_baseline", n).then(setSyncError); };
  const updateSettings = (n) => {
    // Strip the injected keys before persisting: institutions live in their own table,
    // and writing them into nrv_settings would create a second, staler copy.
    const { institutions, siteOverrides, ...persistable } = n;
    setSettings(persistable);
    saveKey("nrv_settings", persistable).then(setSyncError);
  };
  const updateExplorer = (n) => { setExplorer(n); saveKey("nrv_explorer", n).then(setSyncError); };

  if (!ready) return <div className="min-h-screen flex items-center justify-center bg-slate-50"><Loader2 className="w-6 h-6 animate-spin text-teal-600" /></div>;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900" style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif" }}>
      <header className="border-b border-slate-200 bg-white sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-teal-500 to-indigo-600 flex items-center justify-center"><Brain className="w-5 h-5 text-white" /></div>
            <div><div className="font-semibold tracking-tight leading-none">NeuroRVU</div><div className="text-[11px] text-slate-500 mt-0.5 font-mono">Neuroradiology productivity · CMS 2026</div></div>
          </div>
          <div className="flex items-center gap-1">
            {/* Desktop: inline tabs. Mobile uses the bottom bar below. */}
            <div className="hidden sm:flex items-center gap-1">
              {TABS.map(t => (
                <TabBtn key={t.id} active={tab === t.id} onClick={() => setTab(t.id)} icon={t.icon}>{t.label}</TabBtn>
              ))}
            </div>
            <button onClick={() => setShowSettings(true)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500"><SettingsIcon className="w-4 h-4" /></button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-5 py-6 pb-28 sm:pb-6">
        {syncError && (
          <div role="alert" className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span className="flex-1">{syncError}</span>
            <button onClick={() => setSyncError("")} className="text-xs underline shrink-0">Dismiss</button>
          </div>
        )}
        {tab === "tracker" && <Tracker log={log} reloadExams={reloadExams} settings={settingsWithInstitutions} extraRates={extraRates} extraPeriods={extraPeriods} reloadExtra={reloadExtra} />}
        {tab === "timeline" && <Timeline baseline={baseline} updateBaseline={updateBaseline} updateSettings={updateSettings} log={log} settings={settingsWithInstitutions} extraPeriods={extraPeriods} reloadExtra={reloadExtra} explorer={explorer} updateExplorer={updateExplorer} />}
        {tab === "exams" && <ExamsView log={log} settings={settingsWithInstitutions} />}
        {tab === "uploads" && <UploadsView reloadExams={reloadExams} />}
        {tab === "reference" && <Reference settings={settingsWithInstitutions} />}
      </main>

      {/* Mobile bottom tab bar — native PWA navigation, always visible, no lateral scroll. */}
      <nav className="sm:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-slate-200" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="grid grid-cols-5">
          {TABS.map(t => {
            const active = tab === t.id;
            const Icon = t.icon;
            return (
              <button key={t.id} onClick={() => setTab(t.id)} aria-label={t.label} className={`flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors ${active ? "text-teal-600" : "text-slate-400 hover:text-slate-600"}`}>
                <Icon className="w-5 h-5" strokeWidth={active ? 2.4 : 2} />
                {t.label}
              </button>
            );
          })}
        </div>
      </nav>

      {showSettings && <SettingsDrawer settings={settingsWithInstitutions} onSave={updateSettings} extraRates={extraRates} onSaveExtraRates={saveExtraRates} onSaveInstitutions={saveInstitutions} onClose={() => setShowSettings(false)} />}

      <footer className="max-w-6xl mx-auto px-5 py-6 text-[11px] text-slate-400 leading-relaxed">
        Two data layers, one tool: <span className="text-slate-500 font-medium">Reported</span> (FY26 monthly baseline, authoritative) and <span className="text-slate-500 font-medium">Tracked</span> (your daily screenshot logs, granular).
        They measure the same work at different resolutions and are shown side by side — never summed. Institution loop: <span className="font-mono">UM*</span>/UHealth → UM, Jackson/JHS/JHM → JHS. Not official billing advice.
      </footer>
    </div>
  );
}

function TabBtn({ active, onClick, icon: Icon, children }) {
  return <button onClick={onClick} className={`px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors ${active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}><Icon className="w-4 h-4" />{children}</button>;
}

/* ============================== SHARED ============================== */
function InstitutionCards({ split, settings }) {
  const list = settings.institutions ?? DEFAULT_INSTITUTIONS;
  const order = list.map((i) => i.key);
  const meta = Object.fromEntries(list.map((i) => [i.key, i]));
  const total = order.reduce((s, k) => s + (split[k]?.wrvu ?? 0), 0) || 1;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {order.map(k => {
        const inst = meta[k] ?? instMeta(k), d = split[k] ?? { wrvu: 0, studies: 0 }, pct = (d.wrvu / total) * 100;
        return (
          <div key={k} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wide text-slate-400 flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5" style={{ color: inst.color }} />{inst.label}</span>
              <span className="text-[11px] font-mono text-slate-400">{fmt(pct, 0)}%</span>
            </div>
            <div className="mt-2 text-2xl font-bold font-mono tracking-tight">{fmt(d.wrvu, 0)}</div>
            <div className="mt-1 flex items-center justify-between text-[11px] text-slate-400"><span>{fmt(d.studies, 0)} studies</span><span className="font-mono">${fmt(d.wrvu * settings.ratePerWrvu, 0)}</span></div>
            <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: inst.color }} /></div>
          </div>
        );
      })}
    </div>
  );
}
function Kpi({ icon: Icon, label, value, sub, delta, good, accent }) {
  const up = delta >= 0;
  return (
    <div className={`rounded-2xl border p-4 ${accent ? "bg-slate-900 border-slate-900 text-white" : "bg-white border-slate-200"}`}>
      <div className="flex items-center justify-between"><span className="text-[11px] uppercase tracking-wide text-slate-400">{label}</span><Icon className={`w-4 h-4 ${accent ? "text-teal-400" : "text-slate-300"}`} /></div>
      <div className="mt-2 text-2xl font-bold font-mono tracking-tight">{value}</div>
      <div className="mt-1 flex items-center gap-1.5 text-[11px]">
        {delta !== undefined && <span className={`font-mono font-semibold flex items-center gap-0.5 ${up ? "text-emerald-500" : "text-amber-500"}`}>{up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}{up ? "+" : ""}{fmt(delta, 0)}%</span>}
        <span className={good ? "text-emerald-500 font-semibold" : "text-slate-400"}>{sub}</span>
      </div>
    </div>
  );
}
function Empty({ msg }) { return <div className="h-40 flex flex-col items-center justify-center text-slate-400 gap-2"><Activity className="w-6 h-6" /><p className="text-sm">{msg || "No data yet."}</p></div>; }
function StatTile({ label, value, sub }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-xl font-bold font-mono tracking-tight text-slate-900">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

/* ============================================================================ TIMELINE (merged) ============================================================================ */
// buildTimeline now lives in lib/analytics/timeline.js (N06).

function Timeline({ baseline, updateBaseline, updateSettings, log, settings, extraPeriods = [], reloadExtra, explorer, updateExplorer }) {
  const [view, setView] = useState("coverage"); // coverage | institution | reconcile
  const [editing, setEditing] = useState(false);
  const [delError, setDelError] = useState("");
  const t = useMemo(() => buildTimeline(baseline, log, settings), [baseline, log, settings]);
  // Extra-duty pay is disjoint from the OCR'd baseline `pay` (monthly report) —
  // the consolidated "extra pay" number is their sum, never a double-count.
  const extraDutyYtd = useMemo(() => {
    const yr = localDay().slice(0, 4);
    return Math.round(extraPeriods.filter(p => String(p.bundleDate).slice(0, 4) === yr).reduce((s, p) => s + (Number(p.amount) || 0), 0));
  }, [extraPeriods]);
  // --- Monthly-report import (PDF/photo -> consolidate into the baseline) ---
  const importRef = useRef();
  const [impBusy, setImpBusy] = useState(false);
  const [impStatus, setImpStatus] = useState("");
  const [impPreview, setImpPreview] = useState(null); // { plan, totals, period, syncSettings }
  const [syncSettings, setSyncSettings] = useState(true);
  // N00f/D8 — a PHOTO of a report is an image reaching /api/claude, so it needs
  // its own redaction profile for (this user, this institution). PDFs are sent
  // as document blocks and are out of this node's scope.
  const [impInst, setImpInst] = useState(() => (settings.institutions ?? DEFAULT_INSTITUTIONS)[0]?.key ?? "UM");
  const [reportProfile, setReportProfile] = useState(null);
  const [impTagger, setImpTagger] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await loadKey(redactionProfileKey(REDACTION_SURFACES.REPORT, impInst), null);
      if (!cancelled) setReportProfile(stored && typeof stored === "object" ? stored : null);
    })();
    return () => { cancelled = true; };
  }, [impInst]);

  async function handleImport(e) {
    const file = (e.target.files || [])[0];
    if (importRef.current) importRef.current.value = "";
    if (!file) return;
    await runImport(file, reportProfile);
  }

  async function saveReportRedactionProfile(regions, meta) {
    const pending = impTagger;
    try {
      const profile = buildRedactionProfile({
        surface: REDACTION_SURFACES.REPORT, institution: impInst, regions, aspect: meta.aspect,
      });
      setReportProfile(profile);
      setImpTagger(null);
      await saveKey(redactionProfileKey(REDACTION_SURFACES.REPORT, impInst), profile);
      if (pending?.file) await runImport(pending.file, profile);
    } catch (err) {
      console.error("[redaction] report profile save failed:", { code: err?.code, message: err?.message });
      setImpStatus(ocrErrorMessage(err));
    }
  }

  async function runImport(file, profile) {
    setImpBusy(true); setImpPreview(null); setImpStatus(`Reading ${file.name || "report"}…`);
    try {
      let doc;
      try {
        doc = await prepareDoc(file, profile);
      } catch (err) {
        if (err?.code === "redaction-profile-required") {
          setImpStatus(err.message);
          setImpTagger({ file, reasonMessage: err.message });
          return;
        }
        throw err;
      }
      const data = await callClaude("timeline", { attachments: [doc] });
      const raw = textOf(data).replace(/```json/gi, "").replace(/```/g, "").trim();
      const so = raw.indexOf("{"), eo = raw.lastIndexOf("}");
      const parsed = JSON.parse(so !== -1 ? raw.slice(so, eo + 1) : raw);
      if (parsed && parsed.valid === false) { setImpStatus(parsed.reason || "That doesn't look like a monthly wRVU productivity report. Upload your FY/monthly productivity summary (PDF or photo)."); return; }
      const months = Array.isArray(parsed?.months) ? parsed.months : [];
      if (!months.length) { setImpStatus("No monthly rows were detected. Make sure the per-month benchmark/actual table is fully visible, then try again."); return; }
      const plan = consolidateBaseline(baseline, months);
      if (!plan.added.length && !plan.discrepancies.length) {
        setImpPreview({ plan, totals: parsed.totals || {}, period: parsed.period || {} });
        setImpStatus(`Already up to date — ${plan.unchanged.length} month(s) matched, nothing new to add.`);
        return;
      }
      setImpPreview({ plan, totals: parsed.totals || {}, period: parsed.period || {} });
      setImpStatus("");
    } catch (err) {
      console.error("[timeline-import] failed:", { status: err?.status, code: err?.code, detail: err?.detail, message: err?.message });
      setImpStatus(ocrErrorMessage(err));
    } finally {
      setImpBusy(false);
    }
  }

  function applyImport() {
    if (!impPreview) return;
    updateBaseline(impPreview.plan.merged);
    if (syncSettings && updateSettings) {
      const tot = impPreview.totals || {};
      const monthlyBench = Math.max(0, ...impPreview.plan.merged.map(m => Number(m.bench) || 0));
      const next = { ...settings };
      if (Number.isFinite(tot.uhealth) && tot.uhealth != null) next.umYTD = num(tot.uhealth);
      if (Number.isFinite(tot.jhs) && tot.jhs != null) next.jhsYTD = num(tot.jhs);
      if (monthlyBench > 0) next.monthlyBenchmark = Math.round(monthlyBench);
      updateSettings(next);
    }
    const { added, discrepancies } = impPreview.plan;
    setImpStatus(`Imported — ${added.length} month(s) added${discrepancies.length ? `, ${discrepancies.length} updated` : ""}. Your timeline is consolidated.`);
    setImpPreview(null);
  }
  function cancelImport() { setImpPreview(null); setImpStatus(""); }
  const C = { um: "#f97316", jhs: "#0ea5e9", base: "#0d9488", extra: "#5eead4", bench: "#6366f1", cum: "#0f172a", trk: "#0d9488" };

  // ---- Tracked explorer: custom date range × weekly/monthly ----
  // Selection state lives in the root (persisted per user via /api/store under
  // "nrv_explorer") so the last-picked period survives tab switches + reopens.
  const dataDays = useMemo(() => log.map(s => String(s.date).slice(0, 10)).filter(Boolean).sort(), [log]);
  const dataMin = dataDays[0] || localDay(), dataMax = dataDays[dataDays.length - 1] || localDay();
  const { gran, start: rStart, end: rEnd } = explorer;
  const setGran = (g) => updateExplorer({ ...explorer, gran: g });
  const setRStart = (s) => updateExplorer({ ...explorer, start: s });
  const setREnd = (e) => updateExplorer({ ...explorer, end: e });
  // Unset bounds fall back to the full tracked span (nothing saved until the
  // user actually picks — a fresh account keeps following its growing data).
  const start = rStart || dataMin, end = rEnd || dataMax;
  const range = useMemo(() => buildRange(log, settings, start, end, gran), [log, settings, start, end, gran]);
  const exRange = useMemo(() => buildExtraDuty(extraPeriods, start, end, gran), [extraPeriods, start, end, gran]);
  async function delPeriod(id) {
    try {
      const r = await fetch(`/api/extra-duty?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!r.ok) { setDelError(await apiFailure(r, "Couldn't delete that shift")); return; }
      setDelError("");
      await reloadExtra?.();
    } catch { setDelError(networkFailure("Couldn't delete that shift")); }
  }
  const preset = (s, e) => updateExplorer({ ...explorer, start: s, end: e });
  // Every institution except the default: the default is where unattributed work lands
  // and carries no reported YTD figure, so it would render as a 0-width slice.
  const instList = (t.institutions ?? DEFAULT_INSTITUTIONS);
  const reportable = instList.filter((i) => !i.isDefault);
  // Rows become authoritative the moment ANY of them carries a figure. Falling back
  // per-key instead would mean a user who deliberately sets UM to 0 keeps seeing the old
  // umYTD forever, because 0 and "not migrated yet" are indistinguishable one key at a
  // time. Whole-set is unambiguous, and it self-heals on the first save from Settings.
  const rowsHaveYtd = reportable.some((i) => Number(settings.ytdByInstitution?.[i.key]) > 0);
  const legacyYtd = (k) => Number(k === "UM" ? settings.umYTD : k === "JHS" ? settings.jhsYTD : 0) || 0;
  const ytdOf = (k) => (rowsHaveYtd ? Number(settings.ytdByInstitution?.[k]) || 0 : legacyYtd(k));
  const donut = reportable.map((i) => ({ name: i.label, value: ytdOf(i.key), color: i.color }));
  const instTotal = donut.reduce((sum, d) => sum + d.value, 0);
  const instMismatch = Math.abs(instTotal - t.ytd.total) > 5;

  function editMonth(key, field, val) {
    updateBaseline(baseline.map(b => b.key === key ? { ...b, [field]: Number(val) || 0 } : b));
  }
  function addMonth() {
    const last = baseline[baseline.length - 1];
    const [y, m] = (last ? last.key : "2025-09").split("-").map(Number);
    const nm = m === 12 ? 1 : m + 1, ny = m === 12 ? y + 1 : y;
    const key = `${ny}-${String(nm).padStart(2, "0")}`;
    if (baseline.find(b => b.key === key)) return;
    updateBaseline([...baseline, { key, mo: MONTH_LABEL(key), cfte: settings.cFTE, bench: Math.round(settings.monthlyBenchmark * settings.cFTE), base: 0, extra: 0, pay: 0 }]);
  }
  function delMonth(key) { updateBaseline(baseline.filter(b => b.key !== key)); }
  function resetBaseline() { updateBaseline([]); }

  return (
    <div className="space-y-5">
      {impTagger && (
        <RedactionTagger
          file={impTagger.file}
          institution={impInst}
          institutions={instList.map((i) => i.key)}
          onInstitutionChange={setImpInst}
          reasonMessage={impTagger.reasonMessage}
          onCancel={() => { setImpTagger(null); setImpStatus("Import cancelled — nothing was sent."); }}
          onSave={saveReportRedactionProfile}
        />
      )}
      {/* ===== Tracked explorer: pick a date range + weekly/monthly ===== */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div>
            <h2 className="font-semibold flex items-center gap-2"><Calendar className="w-4 h-4 text-teal-600" />Tracked explorer</h2>
            <p className="text-xs text-slate-500">Pick a start &amp; finish date and see your tracked wRVU by week or month.</p>
          </div>
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5 text-xs font-medium">
            <button onClick={() => setGran("week")} className={`px-3 py-1.5 rounded-md ${gran === "week" ? "bg-white shadow-sm text-slate-900" : "text-slate-500"}`}>Weekly</button>
            <button onClick={() => setGran("month")} className={`px-3 py-1.5 rounded-md ${gran === "month" ? "bg-white shadow-sm text-slate-900" : "text-slate-500"}`}>Monthly</button>
          </div>
        </div>

        {/* Date inputs + quick presets */}
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <label className="flex flex-col gap-1 text-[11px] font-medium text-slate-500">Start
            <input type="date" value={start} min={dataMin} max={end} onChange={e => setRStart(e.target.value)}
              className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm text-slate-900 font-mono" /></label>
          <label className="flex flex-col gap-1 text-[11px] font-medium text-slate-500">Finish
            <input type="date" value={end} min={start} max={dataMax} onChange={e => setREnd(e.target.value)}
              className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm text-slate-900 font-mono" /></label>
          <div className="flex flex-wrap items-center gap-1 text-[11px] font-medium">
            {[
              { l: "This month", s: `${localMonth()}-01`, e: localDay() },
              { l: "Last 30d", s: daysAgo(30), e: localDay() },
              { l: "Last 90d", s: daysAgo(90), e: localDay() },
              { l: "YTD", s: `${new Date().getFullYear()}-01-01`, e: localDay() },
              { l: "All", s: dataMin, e: dataMax },
            ].map(p => (
              <button key={p.l} onClick={() => preset(p.s, p.e)}
                className="px-2.5 py-1 rounded-md bg-slate-100 text-slate-600 hover:bg-slate-200">{p.l}</button>
            ))}
          </div>
        </div>

        {/* Range stat tiles */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-4">
          <StatTile label="Tracked wRVU" value={fmt(range.stats.total, 0)} sub={`${fmt(range.stats.studies, 0)} studies`} />
          <StatTile label={gran === "week" ? "Avg / week" : "Avg / month"} value={fmt(range.stats.avgPerBucket, 0)}
            sub={`vs ${fmt(range.bench, 0)} target · ${range.stats.vsBenchPct >= 0 ? "+" : ""}${fmt(range.stats.vsBenchPct, 0)}%`} />
          <StatTile label="Avg / active day" value={fmt(range.stats.avgPerDay, 1)} sub={`${fmt(range.stats.activeDays, 0)} days logged`} />
          <StatTile label="UM / JHS split" value={`${fmt(range.stats.umPct, 0)} / ${fmt(100 - range.stats.umPct, 0)}`} sub={`${fmt(range.stats.um, 0)} · ${fmt(range.stats.jhs, 0)} wRVU`} />
        </div>

        {/* Range chart */}
        {range.rows.length ? (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={range.rows} margin={{ top: 10, right: 12, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f6" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis yAxisId="l" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #e2e8f0" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine yAxisId="l" y={range.bench} stroke={C.bench} strokeDasharray="5 4" strokeWidth={1.5} />
                <Bar yAxisId="l" dataKey="wrvu" name={gran === "week" ? "Tracked wRVU / week" : "Tracked wRVU / month"} fill={C.trk} radius={[5, 5, 0, 0]} />
                <Line yAxisId="r" type="monotone" dataKey="cum" name="Cumulative" stroke={C.cum} strokeWidth={2} dot={{ r: 2.5 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : <Empty msg="No tracked exams in this date range." />}
        <p className="text-[11px] text-slate-400 mt-2 flex items-start gap-1.5"><Info className="w-3.5 h-3.5 mt-px shrink-0" />
          Dashed line = {gran === "week" ? "weekly" : "monthly"} target ({fmt(range.bench, 0)} wRVU{gran === "week" ? ", = monthly ÷ 4.3" : ""}). Weeks start Monday. Buckets use each exam&apos;s own date.
          {range.stats.best && <> Best {gran === "week" ? "week" : "month"}: <span className="font-medium text-slate-500">{range.stats.best.label}</span> ({fmt(range.stats.best.wrvu, 0)} wRVU).</>}
        </p>
      </div>

      {/* ===== Extra-duty earnings (per-diem + PPC) for the selected range ===== */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div>
            <h2 className="font-semibold flex items-center gap-2"><Zap className="w-4 h-4 text-amber-600" />Extra-duty earnings</h2>
            <p className="text-xs text-slate-500">Per-diem &amp; pay-per-click shifts within the range above ({start} → {end}). Tag uploads as extra duty in the Tracker.</p>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-4">
          <StatTile label="Total extra-duty $" value={`$${fmt(exRange.total, 0)}`} sub={`${exRange.periods.length} shift${exRange.periods.length === 1 ? "" : "s"}`} />
          <StatTile label="Per-diem $" value={`$${fmt(exRange.perDiem, 0)}`} />
          <StatTile label="Pay-per-click $" value={`$${fmt(exRange.ppc, 0)}`} />
          <StatTile label="Exams (extra)" value={fmt(exRange.exams, 0)} sub={gran === "week" ? "weekly buckets" : "monthly buckets"} />
        </div>
        {exRange.periods.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                <th className="py-2 font-medium">Date</th><th className="py-2 font-medium">Model</th>
                <th className="py-2 font-medium text-right">Exams</th><th className="py-2 font-medium">Breakdown</th>
                <th className="py-2 font-medium text-right">$ earned</th><th></th>
              </tr></thead>
              <tbody className="font-mono">
                {exRange.periods.map(p => (
                  <tr key={p.id} className="border-b border-slate-50">
                    <td className="py-1.5 font-sans">{String(p.bundleDate).slice(0, 10)}</td>
                    <td className="py-1.5 font-sans">{p.payModel === "ppc" ? "Pay-per-click" : "Per diem"}{p.label ? <span className="text-slate-400"> · {p.label}</span> : ""}</td>
                    <td className="py-1.5 text-right">{fmt(p.examCount, 0)}</td>
                    <td className="py-1.5 text-[11px] text-slate-500">{p.payModel === "ppc" ? `MRI ${p.countMri} · CT ${p.countCt} · XR ${p.countXr}${p.countOther ? ` · Other ${p.countOther}` : ""}` : "—"}</td>
                    <td className="py-1.5 text-right font-semibold text-amber-700">${fmt(p.amount, 0)}</td>
                    <td className="py-1.5 text-right"><button onClick={() => delPeriod(p.id)} className="text-slate-300 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty msg="No extra-duty shifts in this date range." />}
        {delError && (
          <p role="alert" className="mt-3 flex items-start gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
            <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />{delError}
          </p>
        )}
        <p className="text-[11px] text-slate-400 mt-3 flex items-start gap-1.5"><Info className="w-3.5 h-3.5 mt-px shrink-0" />Extra duty is paid separately and never counts toward your wRVU target. Its YTD total is folded into the &quot;Extra pay YTD (all sources)&quot; KPI below.</p>
      </div>

      {/* Official YTD KPIs (from reported baseline) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={TrendingUp} label="YTD reported vs benchmark" value={fmt(t.ytd.base)} sub={`vs ${fmt(t.ytd.bench)} · +${fmt(t.ytd.variancePct, 0)}%`} good />
        <Kpi icon={Calendar} label="Total incl. extra coverage" value={fmt(t.ytd.total)} sub={`${fmt(t.ytd.base)} base + ${fmt(t.ytd.extra)} extra`} />
        <Kpi icon={DollarSign} label="Extra pay YTD (all sources)" value={`$${fmt(t.ytd.pay + extraDutyYtd)}`} sub={`reported $${fmt(t.ytd.pay)} + extra-duty $${fmt(extraDutyYtd)}`} accent />
        <Kpi icon={Building2} label="Institution split (YTD)"
             value={reportable.map((i) => fmt((t.shares?.[i.key] ?? 0) * 100, 0)).join(" / ")}
             sub={reportable.map((i) => `${i.short} ${fmt(ytdOf(i.key))}`).join(" · ")} />
      </div>

      {/* Chart */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <h2 className="font-semibold flex items-center gap-2">Productivity timeline
              <span className="text-[10px] font-normal text-emerald-600 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />reconciled</span>
            </h2>
            <p className="text-xs text-slate-500">Reported baseline + your tracked logs · dashed indigo = benchmark · black line = cumulative</p>
          </div>
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5 text-xs font-medium">
            <button onClick={() => setView("coverage")} className={`px-3 py-1.5 rounded-md ${view === "coverage" ? "bg-white shadow-sm text-slate-900" : "text-slate-500"}`}>Base vs extra</button>
            <button onClick={() => setView("institution")} className={`px-3 py-1.5 rounded-md ${view === "institution" ? "bg-white shadow-sm text-slate-900" : "text-slate-500"}`}>UM vs JHS*</button>
            <button onClick={() => setView("reconcile")} className={`px-3 py-1.5 rounded-md ${view === "reconcile" ? "bg-white shadow-sm text-slate-900" : "text-slate-500"}`}>Tracked vs reported</button>
          </div>
        </div>

        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={t.months} margin={{ top: 10, right: 12, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f6" />
              <XAxis dataKey="mo" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="l" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #e2e8f0" }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <ReferenceLine yAxisId="l" y={Math.round(settings.monthlyBenchmark * settings.cFTE)} stroke={C.bench} strokeDasharray="5 4" strokeWidth={1.5} />
              {view === "coverage" && <>
                <Bar yAxisId="l" dataKey="reported" name="Base actual" stackId="a" fill={C.base} />
                <Bar yAxisId="l" dataKey="extra" name="Extra coverage" stackId="a" fill={C.extra} radius={[5, 5, 0, 0]} />
                <Line yAxisId="r" type="monotone" dataKey="cumReported" name="Cumulative" stroke={C.cum} strokeWidth={2} dot={{ r: 2.5 }} />
              </>}
              {view === "institution" && <>
                {reportable.map((i, n) => (
                  <Bar key={i.key} yAxisId="l" dataKey={`rep_${i.key}`} name={`${i.label}*`} stackId="a"
                       fill={i.color} radius={n === reportable.length - 1 ? [5, 5, 0, 0] : undefined} />
                ))}
                <Line yAxisId="r" type="monotone" dataKey="cumReported" name="Cumulative" stroke={C.cum} strokeWidth={2} dot={{ r: 2.5 }} />
              </>}
              {view === "reconcile" && <>
                <Bar yAxisId="l" dataKey="reported" name="Reported (official)" fill={C.base} radius={[5, 5, 0, 0]} />
                <Bar yAxisId="l" dataKey="tracked" name="Tracked (your logs)" fill="#fbbf24" radius={[5, 5, 0, 0]} />
                <Line yAxisId="r" type="monotone" dataKey="cumReported" name="Cum. reported" stroke={C.cum} strokeWidth={2} dot={{ r: 2.5 }} />
              </>}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        {view === "institution" && <p className="text-[11px] text-amber-600 mt-2 flex items-start gap-1.5"><Info className="w-3.5 h-3.5 mt-px shrink-0" />* Monthly bars are a proportional estimate ({reportable.map(i => `${i.short} ${fmt((t.shares?.[i.key] ?? 0) * 100, 0)}%`).join(" / ")}). The source reports the split only as a YTD total — only those totals ({reportable.map(i => `${i.short} ${fmt(ytdOf(i.key))}`).join(" · ")}) are exact.</p>}
        {view === "reconcile" && <p className="text-[11px] text-slate-500 mt-2 flex items-start gap-1.5"><Info className="w-3.5 h-3.5 mt-px shrink-0" />Capture completeness = tracked ÷ reported. As you log more daily screenshots, the amber bars rise toward the official reported bars — the gap is what your self-tracking hasn&apos;t captured yet.</p>}
      </div>

      {/* Donut + reconcile table */}
      <div className="grid lg:grid-cols-3 gap-5">
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <h2 className="font-semibold mb-1">Institution split</h2>
          <p className="text-xs text-slate-500 mb-2">YTD total (exact, editable in Settings)</p>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart><Pie data={donut} dataKey="value" nameKey="name" innerRadius={40} outerRadius={60} paddingAngle={2}>{donut.map((d, i) => <Cell key={i} fill={d.color} />)}</Pie>
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #e2e8f0" }} formatter={(v) => `${fmt(v)} wRVU`} /></PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-1.5 mt-1">
            {reportable.map((i) => (
              <InstRow key={i.key} dot={i.color} label={i.label}
                       v={`${fmt(ytdOf(i.key))} · ${fmt((t.shares?.[i.key] ?? 0) * 100, 0)}%`} />
            ))}
            <InstRow dot="#0f172a" label="Total" v={fmt(instTotal)} bold />
          </div>
          {instMismatch && <p className="text-[11px] text-amber-600 mt-2 flex items-start gap-1.5"><AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />Institution YTD total ({fmt(instTotal)}) ≠ baseline total ({fmt(t.ytd.total)}). Update the YTD figures in Settings when new months are added.</p>}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-5 lg:col-span-2 overflow-x-auto">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Reported baseline — monthly database</h2>
            <div className="flex items-center gap-1.5">
              <input ref={importRef} type="file" accept="application/pdf,image/*" onChange={handleImport} className="hidden" id="tl-import" />
              <label htmlFor="tl-import" className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1 cursor-pointer ${impBusy ? "bg-slate-100 text-slate-400" : "bg-indigo-600 text-white hover:bg-indigo-500"}`}>
                {impBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}Import report
              </label>
              <button onClick={() => setEditing(!editing)} className={`px-2.5 py-1 rounded-md text-xs font-medium ${editing ? "bg-teal-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{editing ? "Done" : "Edit"}</button>
              {editing && <><button onClick={addMonth} className="px-2.5 py-1 rounded-md text-xs font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 flex items-center gap-1"><Plus className="w-3 h-3" />Month</button>
                <button onClick={resetBaseline} className="px-2.5 py-1 rounded-md text-xs font-medium text-slate-500 hover:bg-slate-100 flex items-center gap-1"><RotateCcw className="w-3 h-3" />Reset</button></>}
            </div>
          </div>

          {/* Import feedback + review panel (PDF/photo -> consolidated months) */}
          {impStatus && !impPreview && (
            <div className="mb-3 text-xs text-slate-600 flex items-start gap-1.5 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
              {impBusy ? <Loader2 className="w-3.5 h-3.5 mt-px shrink-0 animate-spin text-indigo-500" /> : <Info className="w-3.5 h-3.5 mt-px shrink-0 text-indigo-500" />}
              <span>{impStatus}</span>
            </div>
          )}
          {impPreview && <ImportReview preview={impPreview} syncSettings={syncSettings} setSyncSettings={setSyncSettings} onApply={applyImport} onCancel={cancelImport} settings={settingsWithInstitutions} />}
          {!impStatus && !impPreview && !impBusy && (
            <p className="mb-3 text-[11px] text-slate-400 flex items-start gap-1.5"><Upload className="w-3.5 h-3.5 mt-px shrink-0" />Upload a monthly wRVU report (PDF or photo) to auto-fill this table. Re-uploading a newer report keeps your existing months and adds the new ones — you&apos;ll be shown any discrepancies before anything changes.</p>
          )}
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
              <th className="py-2 font-medium">Month</th><th className="py-2 font-medium text-right">Bench</th><th className="py-2 font-medium text-right">Actual</th>
              <th className="py-2 font-medium text-right">Var %</th><th className="py-2 font-medium text-right">Extra</th><th className="py-2 font-medium text-right">Total</th>
              <th className="py-2 font-medium text-right">Tracked</th>{editing && <th></th>}
            </tr></thead>
            <tbody className="font-mono">
              {t.months.filter(m => baseline.find(b => b.key === m.key)).map(m => (
                <tr key={m.key} className="border-b border-slate-50">
                  <td className="py-1.5 font-sans">{m.mo}</td>
                  <td className="py-1.5 text-right text-slate-500">{editing ? <NumCell v={m.bench} onChange={v => editMonth(m.key, "bench", v)} /> : fmt(m.bench)}</td>
                  <td className="py-1.5 text-right font-semibold">{editing ? <NumCell v={m.reported} onChange={v => editMonth(m.key, "base", v)} /> : fmt(m.reported)}</td>
                  <td className={`py-1.5 text-right ${m.variance >= 0 ? "text-emerald-600" : "text-amber-600"}`}>{m.variance >= 0 ? "+" : ""}{fmt(m.variancePct, 0)}%</td>
                  <td className="py-1.5 text-right text-teal-600">{editing ? <NumCell v={m.extra} onChange={v => editMonth(m.key, "extra", v)} /> : (m.extra ? fmt(m.extra) : "—")}</td>
                  <td className="py-1.5 text-right">{fmt(m.total)}</td>
                  <td className="py-1.5 text-right text-amber-600">{m.tracked ? `${fmt(m.tracked)} (${fmt(m.capture, 0)}%)` : "—"}</td>
                  {editing && <td className="py-1.5 text-right"><button onClick={() => delMonth(m.key)} className="text-slate-300 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button></td>}
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t-2 border-slate-200 font-mono">
              <td className="py-2 font-sans font-semibold">YTD</td><td className="py-2 text-right text-slate-500">{fmt(t.ytd.bench)}</td>
              <td className="py-2 text-right font-bold">{fmt(t.ytd.base)}</td><td className="py-2 text-right text-emerald-600 font-semibold">+{fmt(t.ytd.variancePct, 0)}%</td>
              <td className="py-2 text-right text-teal-600 font-semibold">{fmt(t.ytd.extra)}</td><td className="py-2 text-right font-bold">{fmt(t.ytd.total)}</td>
              <td className="py-2 text-right"></td>{editing && <td></td>}
            </tr></tfoot>
          </table>
          <p className="text-[11px] text-slate-400 mt-3 flex items-start gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 mt-px shrink-0 text-emerald-500" />&quot;Tracked&quot; shows your daily-log capture vs each reported month. Add or edit your reported months above to reconcile your own data against benchmark.</p>
        </div>
      </div>
    </div>
  );
}
// Review panel shown after a monthly report is OCR'd, before it's committed.
// Surfaces what will be added, what changed (discrepancies), and lets the user
// confirm — nothing touches the stored timeline until "Apply import".
function ImportReview({ preview, syncSettings, setSyncSettings, onApply, onCancel, settings }) {
  const { plan, totals = {}, period = {} } = preview;
  const { added = [], discrepancies = [], unchanged = [], skipped = [] } = plan;
  const monthlyBench = Math.max(0, ...plan.merged.map(m => Number(m.bench) || 0));
  const willSync = [];
  if (totals.uhealth != null) willSync.push(`UHealth YTD ${fmt(settings.umYTD)} → ${fmt(totals.uhealth)}`);
  if (totals.jhs != null) willSync.push(`JHS YTD ${fmt(settings.jhsYTD)} → ${fmt(totals.jhs)}`);
  if (monthlyBench > 0 && Math.round(monthlyBench) !== settings.monthlyBenchmark) willSync.push(`Monthly benchmark ${fmt(settings.monthlyBenchmark)} → ${fmt(Math.round(monthlyBench))}`);
  const nothingNew = !added.length && !discrepancies.length;

  return (
    <div className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold text-indigo-900 flex items-center gap-2"><FileImage className="w-4 h-4" />Review import{period.label ? ` · ${period.label}` : ""}</div>
        <div className="text-[11px] font-mono text-indigo-700">{added.length} new · {discrepancies.length} changed · {unchanged.length} unchanged</div>
      </div>

      {!!added.length && (
        <div className="mb-2">
          <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">Months to add</div>
          <div className="flex flex-wrap gap-1.5">
            {added.map(m => <span key={m.key} className="text-xs font-mono rounded-md bg-white border border-emerald-200 text-emerald-700 px-2 py-0.5">{m.mo}: {fmt(m.base)} wRVU</span>)}
          </div>
        </div>
      )}

      {!!discrepancies.length && (
        <div className="mb-2">
          <div className="text-[11px] uppercase tracking-wide text-amber-600 mb-1 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />Discrepancies — existing months whose values changed</div>
          <div className="space-y-1">
            {discrepancies.map(d => (
              <div key={d.key} className="text-xs bg-white border border-amber-200 rounded-md px-2.5 py-1.5">
                <span className="font-sans font-medium text-slate-700">{d.mo}</span>
                <span className="ml-2 font-mono text-slate-500">{d.changes.map(c => `${FIELD_LABEL[c.field] || c.field} ${fmt(c.from, c.field === "cfte" ? 2 : 0)}→${fmt(c.to, c.field === "cfte" ? 2 : 0)}`).join(" · ")}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-amber-600 mt-1">The newer report&apos;s values will replace these on import.</p>
        </div>
      )}

      {nothingNew && <p className="text-xs text-slate-600 mb-2">Every month in this report already matches your timeline — importing will make no changes.</p>}
      {!!skipped.length && <p className="text-[11px] text-slate-400 mb-2">{skipped.length} blank/empty month row(s) ignored.</p>}

      {!!willSync.length && (
        <label className="flex items-start gap-2 text-xs text-slate-600 mb-3 cursor-pointer">
          <input type="checkbox" checked={syncSettings} onChange={e => setSyncSettings(e.target.checked)} className="mt-0.5" />
          <span>Also update my institution split &amp; benchmark from this report&apos;s totals: <span className="font-mono text-slate-500">{willSync.join(" · ")}</span></span>
        </label>
      )}

      <div className="flex items-center gap-2">
        <button onClick={onApply} disabled={nothingNew} className={`px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 ${nothingNew ? "bg-slate-200 text-slate-400 cursor-not-allowed" : "bg-indigo-600 text-white hover:bg-indigo-500"}`}><Check className="w-4 h-4" />Apply import</button>
        <button onClick={onCancel} className="px-3 py-1.5 rounded-lg text-sm font-medium text-slate-600 hover:bg-white">Cancel</button>
      </div>
    </div>
  );
}
function InstRow({ dot, label, v, bold }) {
  return <div className="flex items-center gap-2 text-sm"><span className="w-2 h-2 rounded-full" style={{ background: dot }} /><span className={`flex-1 ${bold ? "font-semibold" : "text-slate-600"}`}>{label}</span><span className={`font-mono text-xs ${bold ? "font-bold" : ""}`}>{v}</span></div>;
}
function NumCell({ v, onChange }) {
  return <input type="number" value={v} onChange={e => onChange(e.target.value)} className="w-16 text-right border border-slate-200 rounded px-1 py-0.5 text-xs font-mono focus:border-teal-400 outline-none" />;
}

/* ============================================================================ TRACKER ============================================================================ */
function Tracker({ log, reloadExams, settings, extraRates = { perDiemRate: 0, ppcMri: 0, ppcCt: 0, ppcXr: 0 }, extraPeriods = [], reloadExtra }) {
  const prices = usePriceBook();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [draft, setDraft] = useState(null);
  const [manualDate, setManualDate] = useState(localDay());
  // The configured set, not three literals. A user with four institutions gets four
  // buttons; one who has never opened Settings gets the built-in three.
  const instList = settings.institutions ?? DEFAULT_INSTITUTIONS;
  const instKeys = instList.map((i) => i.key);
  const instBy = Object.fromEntries(instList.map((i) => [i.key, i]));
  const [curInst, setCurInst] = useState(instKeys[0] ?? "UM");
  const fileRef = useRef();
  // N00f/D8 — redaction profile for (this user, curInst). Loaded per institution;
  // `tagger` holds the upload that is BLOCKED until the columns are marked.
  const [redactionProfile, setRedactionProfile] = useState(null);
  const [tagger, setTagger] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await loadKey(redactionProfileKey(REDACTION_SURFACES.WORKLIST, curInst), null);
      if (!cancelled) setRedactionProfile(stored && typeof stored === "object" ? stored : null);
    })();
    return () => { cancelled = true; };
  }, [curInst]);

  // Extra-duty tagging: 'regular' = today's flow (counts toward wRVU target);
  // 'extra' = log a paid shift (per-diem or PPC) into extra_duty_periods instead.
  const [mode, setMode] = useState("regular");
  const [payModel, setPayModel] = useState("per_diem");   // per_diem | ppc
  const [exCounts, setExCounts] = useState({ mri: 0, ct: 0, xr: 0, other: 0 });
  const [exExams, setExExams] = useState(0);              // per-diem exam count
  const [exAmount, setExAmount] = useState("");           // per-diem $ override ('' => rate)
  const [exLabel, setExLabel] = useState("");
  // Seed the editable extra-duty counts from the OCR draft (or empty for manual).
  useEffect(() => {
    if (mode !== "extra") return;
    const c = draft ? bucketCounts(draft.items) : { mri: 0, ct: 0, xr: 0, other: 0 };
    setExCounts(c);
    setExExams(draft ? draft.items.length : (c.mri + c.ct + c.xr + c.other));
  }, [draft, mode]);

  const exTotalCounts = exCounts.mri + exCounts.ct + exCounts.xr + exCounts.other;
  const ppcAmount = exCounts.mri * (Number(extraRates.ppcMri) || 0)
    + exCounts.ct * (Number(extraRates.ppcCt) || 0)
    + exCounts.xr * (Number(extraRates.ppcXr) || 0);
  const perDiemAmount = exAmount === "" ? (Number(extraRates.perDiemRate) || 0) : (Number(exAmount) || 0);
  const exAmountFinal = payModel === "ppc" ? ppcAmount : perDiemAmount;

  // This-month + YTD extra-duty pay for the KPI tile.
  const exStats = useMemo(() => {
    const mo = localMonth(), yr = localDay().slice(0, 4);
    let month = 0, ytd = 0;
    for (const p of extraPeriods) {
      const day = String(p.bundleDate).slice(0, 10), amt = Number(p.amount) || 0;
      if (day.slice(0, 7) === mo) month += amt;
      if (day.slice(0, 4) === yr) ytd += amt;
    }
    return { month: Math.round(month), ytd: Math.round(ytd) };
  }, [extraPeriods]);

  async function commitExtra() {
    setBusy(true);
    try {
      const body = {
        payModel,
        bundleDate: `${manualDate}T00:00:00`,
        examCount: payModel === "ppc" ? exTotalCounts : exExams,
        countMri: exCounts.mri, countCt: exCounts.ct, countXr: exCounts.xr, countOther: exCounts.other,
        amount: exAmountFinal,
        rateSnapshot: { perDiem: Number(extraRates.perDiemRate) || 0, mri: Number(extraRates.ppcMri) || 0, ct: Number(extraRates.ppcCt) || 0, xr: Number(extraRates.ppcXr) || 0 },
        label: exLabel || null,
        batchId: draft?.batchId || null,
        source: draft ? "screenshot" : "manual",
      };
      const r = await fetch("/api/extra-duty", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) { setStatus(await apiFailure(r, "Couldn't save that shift")); return; }
      setDraft(null); setExCounts({ mri: 0, ct: 0, xr: 0, other: 0 }); setExExams(0); setExAmount(""); setExLabel("");
      await reloadExtra?.();
      setStatus(`Logged extra-duty ${payModel === "ppc" ? "pay-per-click" : "per-diem"} shift — $${fmt(exAmountFinal)} on ${manualDate}.`);
    } catch { setStatus(networkFailure("Couldn't save that shift")); }
    finally { setBusy(false); }
  }

  async function handleFiles(e) {
    const files = Array.from(e.target.files || []);
    if (fileRef.current) fileRef.current.value = "";
    if (!files.length) return;
    await extractFromScreenshots(files, redactionProfile);
  }

  // N00f/D8 — the ONLY screenshot upload path. A missing or stale redaction
  // profile for this institution blocks the upload and re-prompts the tagger;
  // it never degrades into sending the original.
  async function extractFromScreenshots(files, profile) {
    setBusy(true); setStatus(`Reading ${files.length} screenshot${files.length > 1 ? "s" : ""}…`);
    try {
      let imgs;
      try {
        imgs = [];
        for (const file of files) imgs.push(await buildRedactedImageBlock(file, profile));
      } catch (err) {
        if (err?.code === "redaction-profile-required") {
          setStatus(err.message);
          setTagger({ files, file: files[0], reasonMessage: err.message });
          return;
        }
        throw err;
      }
      const data = await callClaude("ocr", { attachments: imgs });
      // Response is an object: {valid:true, exams:[...]} OR {valid:false, reason:"..."}
      const rawText = textOf(data).replace(/```json/gi, "").replace(/```/g, "").trim();
      const so = rawText.indexOf("{"), eo = rawText.lastIndexOf("}");
      const parsed = JSON.parse(so !== -1 ? rawText.slice(so, eo + 1) : rawText);

      if (parsed && parsed.valid === false) {
        setDraft(null);
        setStatus(parsed.reason || "This doesn't look like an exam worklist (it needs Site, Procedure, and Exam Date columns). Please upload a worklist or RVU report screenshot.");
        return;
      }
      const arr = Array.isArray(parsed?.exams) ? parsed.exams : [];
      let uidc = Date.now();
      const items = arr.map(x => {
        const canon = codeByCpt[String(x.cpt).replace("+", "")];
        const detected = classifyInstitution(x.site || x.institution);
        const inst = detected === "Other" ? curInst : detected;
        // Preview only — the server prices authoritatively on commit. Reading it from
        // the price book keeps the preview and the stored value in agreement instead of
        // showing the user one number and saving another.
        const p = canon ? prices.byCpt[canon.cpt] : null;
        const wrvu = p ? (p.workRvu ?? 0) : (Number(x.wrvu_each) || 0);
        const day = (x.exam_date ? String(x.exam_date) : "").slice(0, 10) || manualDate;
        return {
          uid: ++uidc, cpt: String(x.cpt || "?"),
          desc: x.procedure || (canon ? `${canon.desc} ${canon.con}` : "Unrecognized study"),
          // Reference modality first: it is the only source that knows an X-ray is an
          // X-ray. Never "CT" as a fallback — that is a PAID bucket.
          mod: p?.modality || (canon ? canon.mod : null) || x.modality || "Other",
          wrvu, est: p ? p.workRvu === null : true, inst, site: x.site || "",
          date: day, examDate: x.exam_date || `${day}T00:00:00`, needsPrice: !(wrvu > 0),
        };
      });
      if (!items.length) { setDraft(null); setStatus("No exams detected — the worklist may be cropped or too low-res. Retake a sharper, well-lit shot with the full table in frame, or add manually."); }
      else {
        const unpriced = items.filter(i => i.needsPrice).length;
        const dates = [...new Set(items.map(i => i.date))].sort();
        setDraft({ batchId: `batch_${Date.now()}`, source: "screenshot", items });
        setStatus(`Detected ${items.length} exams across ${dates.length} date${dates.length > 1 ? "s" : ""}.` + (unpriced ? ` ${unpriced} need a code below.` : " Review and save."));
      }
    } catch (err) {
      console.error("[OCR] extraction failed:", { status: err?.status, code: err?.code, detail: err?.detail, message: err?.message });
      setStatus(ocrErrorMessage(err));
    }
    finally { setBusy(false); }
  }

  // Persist the tagged geometry for (this user, this institution) and resume the
  // upload that was blocked. Nothing left the device before this point.
  async function saveRedactionProfile(regions, meta) {
    const pending = tagger;
    try {
      const profile = buildRedactionProfile({
        surface: REDACTION_SURFACES.WORKLIST, institution: curInst, regions, aspect: meta.aspect,
      });
      setRedactionProfile(profile);
      setTagger(null);
      await saveKey(redactionProfileKey(REDACTION_SURFACES.WORKLIST, curInst), profile);
      if (pending?.files?.length) await extractFromScreenshots(pending.files, profile);
    } catch (err) {
      console.error("[redaction] profile save failed:", { code: err?.code, message: err?.message });
      setStatus(ocrErrorMessage(err));
    }
  }

  function addManual(code) {
    setDraft(d => {
      const base = d || { batchId: `batch_${Date.now()}`, source: "manual", items: [] };
      // Preview only. The server re-prices on save and its answer is the one that is
      // stored, so this can never be the figure of record — but it must still agree,
      // and it must not invent one where CMS has none.
      const p = prices.byCpt[code.cpt];
      const item = { uid: Date.now() + Math.random(), cpt: code.cpt, desc: `${code.desc} ${code.con}`, mod: code.mod,
        wrvu: p?.workRvu ?? 0, est: p ? p.workRvu === null : true, inst: curInst, site: "", date: manualDate, examDate: `${manualDate}T00:00:00`, needsPrice: false };
      return { ...base, items: [...base.items, item] };
    });
  }
  function removeDraftItem(it) { setDraft(d => { const items = d.items.filter(i => i.uid !== it.uid); return items.length ? { ...d, items } : null; }); }
  function cycleInst(it) {
    const order = instKeys;
    setDraft(d => ({ ...d, items: d.items.map(i => i.uid === it.uid
      ? { ...i, inst: order[(order.indexOf(i.inst) + 1) % order.length] } : i) }));
  }
  function assignCode(it, code) {
    const p = prices.byCpt[code.cpt];   // preview; the server re-prices on commit
    setDraft(d => ({ ...d, items: d.items.map(i => i.uid === it.uid
      ? { ...i, cpt: code.cpt, desc: `${code.desc} ${code.con}`, mod: code.mod, wrvu: p?.workRvu ?? 0, est: p ? p.workRvu === null : true, needsPrice: false }
      : i) }));
  }
  async function commitDraft() {
    if (!draft || !draft.items.length) return;
    setBusy(true);
    try {
      const payload = {
        batchId: draft.batchId || `batch_${Date.now()}`,
        source: draft.source || "screenshot",
        exams: draft.items.map(i => ({
          examDate: i.examDate || (i.date ? `${i.date}T00:00:00` : null),
          cpt: i.cpt, procedure: i.desc, site: i.site || "",
          institution: i.inst, modality: i.mod, wrvu: i.wrvu, estimated: i.est,
        })),
      };
      const r = await fetch("/api/exams", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!r.ok) { setStatus(await apiFailure(r, "Couldn't save those exams")); return; }
      const left = draft.items.filter(i => i.needsPrice).length;
      setDraft(null);
      await reloadExams();
      setStatus(left ? `Saved. ${left} exam(s) stored at 0 wRVU — assign codes to count their value.` : `Saved ${payload.exams.length} exams to your database.`);
    } catch { setStatus(networkFailure("Couldn't save those exams")); }
    finally { setBusy(false); }
  }

  const a = useMemo(() => buildAnalytics(log, settings), [log, settings]);

  return (
    <div className="space-y-6">
      {tagger && (
        <RedactionTagger
          file={tagger.file}
          institution={curInst}
          reasonMessage={tagger.reasonMessage}
          onCancel={() => { setTagger(null); setStatus("Upload cancelled — nothing was sent."); }}
          onSave={saveRedactionProfile}
        />
      )}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Kpi icon={Calendar} label="Tracked this month" value={fmt(a.thisMonth.actual, 0)} sub={`vs ${fmt(a.thisMonth.bench, 0)} target`} delta={a.thisMonth.variancePct} />
        <Kpi icon={TrendingUp} label="Tracked YTD" value={fmt(a.ytd.actual, 0)} sub={`${fmt(a.ytd.studies, 0)} studies logged`} />
        <Kpi icon={Target} label="Annual projection" value={fmt(a.annual.projected, 0)} sub={`vs ${fmt(a.annual.bench, 0)} target`} delta={a.annual.variancePct} />
        <Kpi icon={DollarSign} label="Tracked comp value" value={`$${fmt(a.ytd.actual * settings.ratePerWrvu, 0)}`} sub={`@ $${settings.ratePerWrvu}/wRVU`} accent />
        <Kpi icon={Zap} label="Extra-duty pay" value={`$${fmt(exStats.month, 0)}`} sub={`$${fmt(exStats.ytd, 0)} YTD · this month`} />
      </div>

      <div>
        <div className="flex items-center gap-2 mb-2"><Building2 className="w-4 h-4 text-slate-500" /><h2 className="font-semibold">Tracked institution split — accumulated wRVU</h2></div>
        <InstitutionCards split={a.institution} settings={settingsWithInstitutions} />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-teal-600" /><h2 className="font-semibold">Log a session</h2></div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
              {instKeys.map(k => <button key={k} onClick={() => setCurInst(k)} className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${curInst === k ? "bg-white shadow-sm" : "text-slate-500"}`} style={curInst === k ? { color: instBy[k]?.color } : {}}>{instBy[k]?.short ?? k}</button>)}
            </div>
            <label className="text-xs text-slate-500 flex items-center gap-2">Date<input type="date" value={manualDate} onChange={e => setManualDate(e.target.value)} className="border border-slate-200 rounded-md px-2 py-1 text-xs font-mono" /></label>
          </div>
        </div>
        {/* Regular vs extra-duty tagging. Extra duty is paid separately and does NOT count toward the wRVU target. */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5 text-xs font-medium">
            <button onClick={() => setMode("regular")} className={`px-3 py-1.5 rounded-md ${mode === "regular" ? "bg-white shadow-sm text-slate-900" : "text-slate-500"}`}>Regular</button>
            <button onClick={() => setMode("extra")} className={`px-3 py-1.5 rounded-md ${mode === "extra" ? "bg-white shadow-sm text-amber-600" : "text-slate-500"}`}>Extra duty</button>
          </div>
          {mode === "extra" && (
            <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5 text-xs font-medium">
              <button onClick={() => setPayModel("per_diem")} className={`px-3 py-1.5 rounded-md ${payModel === "per_diem" ? "bg-white shadow-sm text-slate-900" : "text-slate-500"}`}>Per diem</button>
              <button onClick={() => setPayModel("ppc")} className={`px-3 py-1.5 rounded-md ${payModel === "ppc" ? "bg-white shadow-sm text-slate-900" : "text-slate-500"}`}>Pay-per-click</button>
            </div>
          )}
          {mode === "extra" && <span className="text-[11px] text-amber-600 flex items-center gap-1"><Info className="w-3.5 h-3.5 shrink-0" />Logged as a paid shift — not counted toward your wRVU target.</span>}
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <input ref={fileRef} type="file" accept="image/*" multiple onChange={handleFiles} className="hidden" id="shot" />
            <label htmlFor="shot" className="cursor-pointer flex flex-col items-center justify-center gap-2 h-32 rounded-xl border-2 border-dashed border-slate-300 hover:border-teal-400 hover:bg-teal-50/40 transition-colors">
              {busy ? <><Loader2 className="w-5 h-5 animate-spin text-teal-600" /><span className="text-sm text-slate-500">{status}</span></>
                : <><Upload className="w-5 h-5 text-slate-400" /><span className="text-sm text-slate-600 font-medium">Drop or upload daily productivity screenshots</span><span className="text-[11px] text-slate-400">AI extracts studies, wRVU & detects site (default: {curInst})</span></>}
            </label>
            {/* Direct camera capture — on phones this opens the rear camera straight into OCR. */}
            <input type="file" accept="image/*" capture="environment" multiple onChange={handleFiles} className="hidden" id="cam" />
            <label htmlFor="cam" className="mt-2 cursor-pointer flex items-center justify-center gap-2 h-10 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition-colors">
              <Camera className="w-4 h-4" /> Take photo
            </label>
          </div>
          <ManualAdd onAdd={addManual} />
        </div>
        {status && !busy && <div className="mt-3 text-xs text-slate-500 flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 text-teal-500" />{status}</div>}

        {mode === "regular" && draft && (
          <div className="mt-4 rounded-xl border border-teal-200 bg-teal-50/50 p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium text-teal-900 flex items-center gap-2"><FileImage className="w-4 h-4" />Review — {draft.items.length} exams · {draft.source}</div>
              <div className="text-xs font-mono text-teal-700">{fmt(draft.items.reduce((s, i) => s + i.wrvu, 0), 2)} wRVU</div>
            </div>
            <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
              {draft.items.map(i => (
                <div key={i.uid} className={`flex items-center gap-2 text-sm rounded-lg px-3 py-1.5 border ${i.needsPrice ? "bg-amber-50 border-amber-200" : "bg-white border-teal-100"}`}>
                  <span className="font-mono text-[10px] text-slate-400 w-[68px] shrink-0">{i.date}</span>
                  <span className="font-mono text-xs text-slate-500 w-14 shrink-0">{i.cpt}</span>
                  <span className="flex-1 truncate">{i.desc}{i.est && !i.needsPrice && <span className="text-amber-500 text-[10px] ml-1">est.</span>}{i.needsPrice && <span className="text-amber-600 text-[10px] ml-1 font-semibold uppercase tracking-wide">needs code</span>}</span>
                  {i.needsPrice && <CodeAssign onPick={(c) => assignCode(i, c)} />}
                  <button onClick={() => cycleInst(i)} className="text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0" style={{ background: instMeta(i.inst).color + "22", color: instMeta(i.inst).color }}>{instMeta(i.inst).short}</button>
                  <span className="font-mono text-xs text-slate-400 w-12 text-right shrink-0">{i.wrvu.toFixed(2)}</span>
                  <button onClick={() => removeDraftItem(i)} className="text-slate-300 hover:text-red-500 shrink-0"><X className="w-3.5 h-3.5" /></button>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 mt-3 items-center">
              <button onClick={commitDraft} disabled={busy} className="px-4 py-1.5 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 disabled:opacity-50 flex items-center gap-1.5"><Check className="w-4 h-4" />Save {draft.items.length} exams</button>
              <button onClick={() => setDraft(null)} className="px-3 py-1.5 rounded-lg text-slate-500 text-sm hover:bg-slate-100">Discard</button>
              <span className="text-[11px] text-slate-400">Each row is one exam with its own date. Tap the site badge to reassign. Amber rows need a code.</span>
            </div>
          </div>
        )}

        {mode === "extra" && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/50 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-medium text-amber-900 flex items-center gap-2"><Zap className="w-4 h-4" />Extra-duty shift · {payModel === "ppc" ? "pay-per-click" : "per diem"} · {manualDate}</div>
              {draft && <div className="text-xs font-mono text-amber-700">{draft.items.length} detected</div>}
            </div>

            {payModel === "per_diem" ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <label className="flex flex-col gap-1 text-[11px] font-medium text-slate-500">Exams in shift
                  <input type="number" min="0" value={exExams} onChange={e => setExExams(Math.max(0, Math.round(Number(e.target.value) || 0)))}
                    className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm font-mono text-slate-900" /></label>
                <label className="flex flex-col gap-1 text-[11px] font-medium text-slate-500">Pay for shift ($)
                  <input type="number" min="0" step="0.01" value={exAmount === "" ? "" : exAmount} placeholder={String(Number(extraRates.perDiemRate) || 0)}
                    onChange={e => setExAmount(e.target.value)}
                    className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm font-mono text-slate-900" /></label>
                <div className="flex flex-col gap-1 text-[11px] font-medium text-slate-500">Earnings
                  <div className="rounded-lg bg-white border border-amber-200 px-2.5 py-1.5 text-sm font-mono font-bold text-amber-700">${fmt(exAmountFinal, 0)}</div>
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { k: "mri", label: "MRI", rate: extraRates.ppcMri },
                    { k: "ct", label: "CT", rate: extraRates.ppcCt },
                    { k: "xr", label: "XR", rate: extraRates.ppcXr },
                    { k: "other", label: "Other", rate: 0 },
                  ].map(({ k, label, rate }) => (
                    <label key={k} className="flex flex-col gap-1 text-[11px] font-medium text-slate-500">{label} <span className="text-slate-400">· ${fmt(Number(rate) || 0, 0)}/ea</span>
                      <input type="number" min="0" value={exCounts[k]} onChange={e => setExCounts(c => ({ ...c, [k]: Math.max(0, Math.round(Number(e.target.value) || 0)) }))}
                        className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm font-mono text-slate-900" /></label>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between text-sm">
                  <span className="text-[11px] text-slate-500">{exTotalCounts} exams{exCounts.other ? ` · ${exCounts.other} "Other" not paid` : ""}</span>
                  <span className="font-mono font-bold text-amber-700">${fmt(exAmountFinal, 0)}</span>
                </div>
              </>
            )}

            <div className="flex flex-wrap gap-2 mt-3 items-center">
              <input value={exLabel} onChange={e => setExLabel(e.target.value)} placeholder="Note (optional)"
                className="flex-1 min-w-[140px] border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm bg-white" />
              <button onClick={commitExtra} disabled={busy || exAmountFinal <= 0} className="px-4 py-1.5 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 disabled:opacity-50 flex items-center gap-1.5"><Check className="w-4 h-4" />Save shift</button>
              {draft && <button onClick={() => setDraft(null)} className="px-3 py-1.5 rounded-lg text-slate-500 text-sm hover:bg-slate-100">Clear photo</button>}
            </div>
            <p className="text-[11px] text-slate-400 mt-2 flex items-start gap-1.5"><Info className="w-3.5 h-3.5 mt-px shrink-0" />
              {payModel === "per_diem"
                ? "Pay defaults to your per-diem rate (Settings) — edit it for this shift if it differs. Uses the Date above."
                : "Counts are auto-filled from the photo and editable; earnings = Σ(count × modality rate). Set rates in Settings."}
            </p>
          </div>
        )}
      </div>

      {log.length > 0 && (
        <p className="text-xs text-slate-400 px-1 flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5" />{log.length} exams in your database. View them in the <span className="font-medium text-slate-600">Exams</span> tab, or manage / delete uploads in the <span className="font-medium text-slate-600">Uploads</span> tab.
        </p>
      )}
    </div>
  );
}

/* ============================================================================ UPLOADS ============================================================================ */
function UploadsView({ reloadExams }) {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [examDay, setExamDay] = useState("");
  const [uploadDay, setUploadDay] = useState("");
  const [confirm, setConfirm] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/exams?batches=1");
      if (!r.ok) { setStatus(await apiFailure(r, "Couldn't load your uploads")); return; }
      const j = await r.json();
      setBatches(Array.isArray(j.batches) ? j.batches : []);
      setStatus("");
    } catch { setStatus(networkFailure("Couldn't load your uploads")); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function del(params, label) {
    setBusy(true); setStatus("");
    try {
      const r = await fetch(`/api/exams?${params}`, { method: "DELETE" });
      if (!r.ok) { setStatus(await apiFailure(r, "Delete failed")); return; }
      const j = await r.json();
      setStatus(`Deleted ${j.deleted ?? 0} exam${j.deleted === 1 ? "" : "s"}${label ? ` · ${label}` : ""}.`);
      await load();
      await reloadExams?.();
    } catch { setStatus(networkFailure("Delete failed")); }
    finally { setBusy(false); setConfirm(null); }
  }

  const ts = (d) => d ? new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
  const day = (d) => d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" }) : "—";

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="font-semibold flex items-center gap-2 mb-1"><Calendar className="w-4 h-4 text-slate-500" />Delete by day</h2>
        <p className="text-xs text-slate-400 mb-4">Remove exams by the date shown on the exam, or by the day you uploaded them.</p>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="flex items-end gap-2">
            <label className="flex-1 text-xs text-slate-500">By exam date
              <input type="date" value={examDay} onChange={e => setExamDay(e.target.value)} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono" /></label>
            <button disabled={!examDay || busy} onClick={() => del(`examDate=${examDay}`, `exam date ${examDay}`)} className="px-3 py-2 rounded-lg bg-red-500 text-white text-sm font-medium hover:bg-red-600 disabled:opacity-40">Delete</button>
          </div>
          <div className="flex items-end gap-2">
            <label className="flex-1 text-xs text-slate-500">By upload date
              <input type="date" value={uploadDay} onChange={e => setUploadDay(e.target.value)} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono" /></label>
            <button disabled={!uploadDay || busy} onClick={() => del(`uploadDate=${uploadDay}`, `upload date ${uploadDay}`)} className="px-3 py-2 rounded-lg bg-red-500 text-white text-sm font-medium hover:bg-red-600 disabled:opacity-40">Delete</button>
          </div>
        </div>
        {status && <p className="mt-3 text-xs text-slate-500 flex items-center gap-1.5"><Info className="w-3.5 h-3.5" />{status}</p>}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold flex items-center gap-2"><Layers className="w-4 h-4 text-slate-500" />Uploaded batches</h2>
          <span className="text-xs text-slate-400">{batches.length} batch{batches.length === 1 ? "" : "es"}</span>
        </div>
        {loading ? <div className="py-10 text-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
          : batches.length === 0 ? <div className="py-10 text-center text-slate-400 text-sm"><Layers className="w-6 h-6 mx-auto mb-2" />No uploads yet. Add exams in the Tracker tab.</div>
          : (
            <div className="space-y-2">
              {batches.map(b => (
                <div key={b.batchId} className="flex flex-wrap items-center gap-3 text-sm rounded-xl border border-slate-100 px-4 py-3 hover:bg-slate-50">
                  <div className="flex-1 min-w-[200px]">
                    <div className="font-medium text-slate-800">{b.count} exam{b.count === 1 ? "" : "s"} · {fmt(b.wrvu, 1)} wRVU</div>
                    <div className="text-xs text-slate-400">Uploaded {ts(b.uploadedAt)} · exam dates {day(b.firstExam)}{b.firstExam !== b.lastExam ? `–${day(b.lastExam)}` : ""}{b.sites?.length ? ` · ${b.sites.join(", ")}` : ""}</div>
                  </div>
                  {confirm === b.batchId ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-red-500">Delete {b.count}?</span>
                      <button onClick={() => del(`batchId=${encodeURIComponent(b.batchId)}`, "batch")} className="px-2.5 py-1 rounded-md bg-red-500 text-white text-xs font-medium">Yes</button>
                      <button onClick={() => setConfirm(null)} className="px-2.5 py-1 rounded-md text-slate-500 text-xs hover:bg-slate-100">Cancel</button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirm(b.batchId)} className="inline-flex items-center gap-1 text-xs text-red-500 border border-red-200 rounded-md px-2.5 py-1 hover:bg-red-50"><Trash2 className="w-3.5 h-3.5" />Delete cluster</button>
                  )}
                </div>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}

function CodeAssign({ onPick }) {
  const [q, setQ] = useState("");
  const results = useMemo(() => { if (!q.trim()) return []; const t = q.toLowerCase(); return CODES.filter(c => c.cpt.includes(t) || c.desc.toLowerCase().includes(t) || c.region.toLowerCase().includes(t)).slice(0, 5); }, [q]);
  return (
    <div className="relative">
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="assign code…" className="text-xs border border-amber-300 bg-white rounded px-2 py-1 w-28 outline-none focus:border-amber-500" />
      {results.length > 0 && (
        <div className="absolute z-20 mt-1 w-64 right-0 bg-white border border-slate-200 rounded-lg shadow-lg p-1">
          {results.map(c => <button key={c.cpt} onClick={() => { onPick(c); setQ(""); }} className="w-full flex items-center gap-2 text-left text-xs px-2 py-1 rounded hover:bg-teal-50"><span className="font-mono text-slate-400 w-12">{c.cpt}</span><span className="flex-1 truncate">{c.desc} {c.con}</span><span className="font-mono">{c.wrvu.toFixed(2)}</span></button>)}
        </div>
      )}
    </div>
  );
}
function ManualAdd({ onAdd }) {
  const [q, setQ] = useState("");
  const results = useMemo(() => { if (!q.trim()) return []; const t = q.toLowerCase(); return CODES.filter(c => c.cpt.includes(t) || c.desc.toLowerCase().includes(t) || c.region.toLowerCase().includes(t) || c.mod.toLowerCase() === t).slice(0, 7); }, [q]);
  return (
    <div className="relative">
      <div className="flex items-center gap-2 h-32 rounded-xl border border-slate-200 bg-slate-50/60 p-3 flex-col justify-start">
        <div className="w-full flex items-center gap-2 bg-white rounded-lg border border-slate-200 px-3 py-2"><Search className="w-4 h-4 text-slate-400" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Quick add by CPT, name, or modality…" className="flex-1 text-sm outline-none bg-transparent" /></div>
        <div className="w-full flex-1 overflow-y-auto space-y-1">
          {results.map(c => <button key={c.cpt} onClick={() => { onAdd(c); setQ(""); }} className="w-full flex items-center gap-2 text-left text-sm px-2 py-1 rounded hover:bg-teal-50"><span className="font-mono text-xs text-slate-400 w-12">{c.cpt}</span><span className="flex-1 truncate">{c.desc} <span className="text-slate-400">{c.con}</span></span><span className="font-mono text-xs">{c.wrvu.toFixed(2)}</span><Plus className="w-3.5 h-3.5 text-teal-500" /></button>)}
          {q && !results.length && <div className="text-xs text-slate-400 px-2 py-2">No match.</div>}
        </div>
      </div>
    </div>
  );
}

/* ============================================================================ ANALYTICS (tracked) ============================================================================ */
// buildAnalytics and buildRange now live in lib/analytics/tracked.js (N06).

/* ============================================================================ EXAMS DATABASE ============================================================================ */
function ExamsView({ log, settings }) {
  const [q, setQ] = useState(""); const [mod, setMod] = useState("ALL"); const [inst, setInst] = useState("ALL"); const [sort, setSort] = useState("wrvu");
  const a = useMemo(() => buildAnalytics(log, settings), [log, settings]);
  // Derived, not hardcoded. The old fixed list was ["CT","CTA","MRI","MRA","Add-on"] —
  // five neuro modalities — so an X-ray or ultrasound had no filter to appear under even
  // once it was classified correctly. CMS recognises thirteen.
  const mods = useMemo(
    () => ["ALL", ...[...new Set(Object.values(a.byType).map((x) => x.mod).filter(Boolean))].sort()],
    [a],
  );
  const rows = useMemo(() => {
    const t = q.toLowerCase();
    let r = Object.values(a.byType).filter(x => {
      const c = codeByCpt[x.cpt.replace("+", "")] || {};
      return (mod === "ALL" || x.mod === mod) && (inst === "ALL" || (x.byInst[inst] && x.byInst[inst].count > 0)) &&
        (!t || x.cpt.includes(t) || x.desc.toLowerCase().includes(t) || (c.region || "").toLowerCase().includes(t) || x.mod.toLowerCase() === t);
    });
    r.sort((a, b) => sort === "wrvu" ? b.wrvu - a.wrvu : sort === "count" ? b.count - a.count : a.cpt.localeCompare(b.cpt));
    return r;
  }, [a, q, mod, inst, sort]);
  const totals = useMemo(() => rows.reduce((s, r) => ({ count: s.count + (inst === "ALL" ? r.count : (r.byInst[inst]?.count || 0)), wrvu: s.wrvu + (inst === "ALL" ? r.wrvu : (r.byInst[inst]?.wrvu || 0)) }), { count: 0, wrvu: 0 }), [rows, inst]);

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2 mb-2"><Building2 className="w-4 h-4 text-slate-500" /><h2 className="font-semibold">Tracked wRVU by institution</h2></div>
        <InstitutionCards split={a.institution} settings={settingsWithInstitutions} />
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <div className="flex flex-col lg:flex-row gap-3 lg:items-center">
          <div className="flex-1 flex items-center gap-2 bg-slate-50 rounded-lg border border-slate-200 px-3 py-2"><Search className="w-4 h-4 text-slate-400" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search uploaded exams — CPT, name, region, modality…" className="flex-1 text-sm outline-none bg-transparent" /></div>
          <div className="flex flex-wrap gap-1">
            {mods.map(m => <button key={m} onClick={() => setMod(m)} className={`px-2.5 py-1.5 rounded-lg text-xs font-medium ${mod === m ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{m}</button>)}
            <span className="w-px bg-slate-200 mx-1" />
            {["ALL", ...(settings.institutions ?? DEFAULT_INSTITUTIONS).map(i => i.key)].map(k => {
              const meta = (settings.institutions ?? DEFAULT_INSTITUTIONS).find(i => i.key === k);
              return <button key={k} onClick={() => setInst(k)} className={`px-2.5 py-1.5 rounded-lg text-xs font-medium ${inst === k ? "text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`} style={inst === k ? { background: k === "ALL" ? "#0f172a" : meta?.color } : {}}>{k === "ALL" ? "All sites" : (meta?.short ?? k)}</button>;
            })}
          </div>
        </div>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {Object.keys(a.byType).length === 0 ? <div className="py-12 text-center text-slate-400"><Layers className="w-6 h-6 mx-auto mb-2" /><p className="text-sm">No exams uploaded yet. Log sessions in the Tracker tab.</p></div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-200 bg-slate-50/60">
                <th className="py-2.5 px-4 font-medium">Exam type</th><th className="py-2.5 px-2 font-medium">CPT</th><th className="py-2.5 px-2 font-medium">Mod</th>
                <th className="py-2.5 px-2 font-medium text-right cursor-pointer" onClick={() => setSort("count")}>Count{sort === "count" && " ↓"}</th>
                <th className="py-2.5 px-2 font-medium text-right" style={{ color: INSTITUTIONS.UM.color }}>UM</th><th className="py-2.5 px-2 font-medium text-right" style={{ color: INSTITUTIONS.JHS.color }}>JHS</th>
                <th className="py-2.5 px-2 font-medium text-right">wRVU/ea</th><th className="py-2.5 px-2 font-medium text-right cursor-pointer" onClick={() => setSort("wrvu")}>Σ wRVU{sort === "wrvu" && " ↓"}</th><th className="py-2.5 px-4 font-medium text-right">Comp $</th>
              </tr></thead>
              <tbody>
                {rows.map(r => { const showCount = inst === "ALL" ? r.count : (r.byInst[inst]?.count || 0), showWrvu = inst === "ALL" ? r.wrvu : (r.byInst[inst]?.wrvu || 0);
                  return (
                    <tr key={r.cpt} className="border-b border-slate-50 hover:bg-slate-50/60">
                      <td className="py-2 px-4"><span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full" style={{ background: MOD_COLORS[r.mod] || "#94a3b8" }} />{r.desc}</span></td>
                      <td className="py-2 px-2 font-mono text-xs">{r.cpt}</td><td className="py-2 px-2 text-xs text-slate-500">{r.mod}</td>
                      <td className="py-2 px-2 text-right font-mono font-semibold">{fmt(showCount, 0)}</td>
                      <td className="py-2 px-2 text-right font-mono text-xs" style={{ color: INSTITUTIONS.UM.color }}>{r.byInst.UM ? fmt(r.byInst.UM.count, 0) : "—"}</td>
                      <td className="py-2 px-2 text-right font-mono text-xs" style={{ color: INSTITUTIONS.JHS.color }}>{r.byInst.JHS ? fmt(r.byInst.JHS.count, 0) : "—"}</td>
                      <td className="py-2 px-2 text-right font-mono text-slate-400 text-xs">{r.perStudy.toFixed(2)}</td>
                      <td className="py-2 px-2 text-right font-mono font-semibold">{fmt(showWrvu, 1)}</td>
                      <td className="py-2 px-4 text-right font-mono text-slate-600">${fmt(showWrvu * settings.ratePerWrvu, 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr className="border-t-2 border-slate-200 font-mono bg-slate-50/50">
                <td className="py-2.5 px-4 font-sans font-semibold" colSpan={3}>{rows.length} exam types · {inst === "ALL" ? "all sites" : instMeta(inst).label}</td>
                <td className="py-2.5 px-2 text-right font-bold">{fmt(totals.count, 0)}</td><td colSpan={3}></td>
                <td className="py-2.5 px-2 text-right font-bold">{fmt(totals.wrvu, 1)}</td><td className="py-2.5 px-4 text-right font-bold">${fmt(totals.wrvu * settings.ratePerWrvu, 0)}</td>
              </tr></tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================================ CODES REFERENCE ============================================================================ */
// N00c/D8 — the per-code "live value" lookup is gone. It issued an ad-hoc,
// geographically hardcoded search-tool call on every click: a client-supplied
// prompt AND a client-supplied tool, uncached, unvalidated and billed against the
// shared organisational key. Under INV-SERVER-PROMPTS no template may declare a
// search tool, so the feature has no server-owned form. The static wRVU table
// below is the authoritative figure.
function Reference({ settings }) {
  const prices = usePriceBook();
  const [q, setQ] = useState(""); const [mod, setMod] = useState("ALL");
  const mods = useMemo(
    () => ["ALL", ...[...new Set(CODES.map((c) => c.mod).filter(Boolean))].sort()],
    [],
  );
  const rows = useMemo(() => { const t = q.toLowerCase(); return CODES.filter(c => (mod === "ALL" || c.mod === mod) && (!t || c.cpt.includes(t) || c.desc.toLowerCase().includes(t) || c.region.toLowerCase().includes(t))); }, [q, mod]);
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
          <div className="flex-1 flex items-center gap-2 bg-slate-50 rounded-lg border border-slate-200 px-3 py-2"><Search className="w-4 h-4 text-slate-400" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search CPT, exam, or region…" className="flex-1 text-sm outline-none bg-transparent" /></div>
          <div className="flex flex-wrap gap-1">{mods.map(m => <button key={m} onClick={() => setMod(m)} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${mod === m ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{m}</button>)}</div>
        </div>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-200 bg-slate-50/60">
              <th className="py-2.5 px-4 font-medium">CPT</th><th className="py-2.5 px-2 font-medium">Exam</th><th className="py-2.5 px-2 font-medium">Con.</th><th className="py-2.5 px-2 font-medium text-right">wRVU</th><th className="py-2.5 px-2 font-medium text-right">Comp $</th>
            </tr></thead>
            <tbody>
              {rows.map(c => (
                <tr key={c.cpt} className="border-b border-slate-50 hover:bg-slate-50/60">
                  <td className="py-2 px-4 font-mono text-xs"><span className="font-semibold">{c.cpt}</span>{c.flag && <span className="ml-1.5 text-[9px] px-1 py-0.5 rounded bg-indigo-100 text-indigo-600 align-middle">{c.flag}</span>}</td>
                  <td className="py-2 px-2"><span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full" style={{ background: MOD_COLORS[c.mod] || "#94a3b8" }} />{c.desc}</span></td>
                  <td className="py-2 px-2 font-mono text-xs text-slate-500">{c.con}</td>
                  <td className="py-2 px-2 text-right font-mono font-semibold">{(() => { const p = prices.byCpt[c.cpt];
                    if (prices.loading) return <span className="text-slate-300">…</span>;
                    if (!p) return <span className="text-slate-400" title="Not in the loaded CMS release">n/a</span>;
                    if (p.workRvu === null) return <span className="text-amber-600" title={`No national work RVU — ${p.priceState.replace(/_/g, " ")} (CMS status ${p.statusCode})`}>not priced</span>;
                    return p.workRvu.toFixed(2); })()}</td>
                  <td className="py-2 px-2 text-right font-mono text-slate-600">{(() => { const p = prices.byCpt[c.cpt];
                    // No number means no dollar figure. Rendering $0 here would read as
                    // "this study is worth nothing", which is the opposite of the truth
                    // for a contractor-priced code.
                    if (prices.loading || !p || p.workRvu === null) return <span className="text-slate-300">—</span>;
                    return `$${fmt(p.workRvu * settings.ratePerWrvu, 0)}`; })()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && <div className="py-10 text-center text-sm text-slate-400">No codes match.</div>}
      </div>
      <p className="text-[11px] text-slate-400 px-1">Comp $ = wRVU × your ${settings.ratePerWrvu}/wRVU rate.</p>
    </div>
  );
}

/* ============================================================================ SETTINGS ============================================================================ */
// N18 — the institutions editor. Until this existed the set was whatever seed-institutions
// had written, and the two YTD figures were scalars called umYTD/jhsYTD hardcoded into
// Settings, so a third institution was unreachable from the UI.
//
// The whole set saves in ONE PUT: the default institution, the YTD figures and the site
// mappings are interdependent, and saving them piecemeal would leave the classifier
// pointing at an institution that no longer exists.
function InstitutionsEditor({ value, overrides, onChange, onOverrides }) {
  const setAt = (idx, patch) => onChange(value.map((i, n) => (n === idx ? { ...i, ...patch } : i)));
  // Exactly one default, always: choosing a new one clears the old rather than toggling,
  // because a set with none has nowhere to put an unmapped site (INV-SITE-NEVER-FAILS).
  const makeDefault = (idx) => onChange(value.map((i, n) => ({ ...i, isDefault: n === idx })));
  const add = () => onChange([...value, {
    name: `INST${value.length + 1}`, label: "New institution", shortLabel: `I${value.length + 1}`,
    color: "#64748b", ytdWrvu: 0, isDefault: false,
  }]);
  const remove = (idx) => {
    // An institution with exams behind it is history. The server refuses this too, but
    // its envelope carries a code and nothing else, so the reason has to be visible here.
    if (value.length <= 1 || value[idx].examCount > 0) return;
    const next = value.filter((_, n) => n !== idx);
    if (!next.some((i) => i.isDefault)) next[next.length - 1].isDefault = true;
    onChange(next);
    // Drop mappings that pointed at it, or the save would silently discard them anyway.
    const gone = value[idx].name;
    onOverrides(Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== gone)));
  };
  const rows = Object.entries(overrides);
  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
        <Building2 className="w-3.5 h-3.5 text-teal-600" />Institutions
      </div>
      <p className="text-[11px] text-slate-400 -mt-2">
        Your reported YTD wRVU per institution. The reported monthly split is divided by these shares.
        One institution is the default — anything whose site does not match lands there rather than being dropped.
      </p>
      {value.map((i, idx) => (
        <div key={idx} className="rounded-xl border border-slate-200 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <input aria-label={`Institution ${idx + 1} colour`} type="color" value={i.color || "#64748b"}
                   onChange={e => setAt(idx, { color: e.target.value })}
                   className="w-7 h-7 rounded border border-slate-200 shrink-0 bg-white" />
            <input aria-label={`Institution ${idx + 1} name`} value={i.label} placeholder="Display name"
                   onChange={e => setAt(idx, { label: e.target.value })}
                   className="flex-1 min-w-0 border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
            <button type="button" onClick={() => remove(idx)}
                    disabled={value.length <= 1 || i.examCount > 0}
                    aria-label={`Remove ${i.label}`}
                    title={i.examCount > 0
                      ? `${i.label} has ${i.examCount} exams attributed to it and cannot be removed`
                      : `Remove ${i.label}`}
                    className="p-1.5 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30 disabled:hover:bg-transparent">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <input aria-label={`Institution ${idx + 1} short label`} value={i.shortLabel} placeholder="Short"
                   onChange={e => setAt(idx, { shortLabel: e.target.value })}
                   className="w-20 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-mono" />
            <input aria-label={`Institution ${idx + 1} YTD wRVU`} type="number" step="1" value={i.ytdWrvu}
                   onChange={e => setAt(idx, { ytdWrvu: Math.max(0, Number(e.target.value) || 0) })}
                   className="flex-1 min-w-0 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-mono" />
            <label className="flex items-center gap-1 text-[11px] text-slate-500 shrink-0">
              <input type="radio" name="default-institution" checked={!!i.isDefault}
                     onChange={() => makeDefault(idx)} aria-label={`Make ${i.label} the default`} />
              default
            </label>
          </div>
          {i.examCount > 0 && (
            <p className="text-[10px] text-slate-400">{i.examCount} exams attributed — cannot be removed</p>
          )}
        </div>
      ))}
      <button type="button" onClick={add}
              className="w-full py-1.5 rounded-lg border border-dashed border-slate-300 text-xs text-slate-500 hover:border-teal-400 hover:text-teal-600">
        + Add institution
      </button>

      <div className="pt-2 border-t border-slate-100" />
      <div className="text-sm font-semibold text-slate-700">Site mappings</div>
      <p className="text-[11px] text-slate-400 -mt-2">
        Send a specific site string to an institution. A mapping you write here beats every built-in pattern.
      </p>
      {rows.map(([pattern, name], idx) => (
        <div key={idx} className="flex items-center gap-2">
          <input aria-label={`Site pattern ${idx + 1}`} value={pattern} placeholder="e.g. UMBRELLA CLINIC"
                 onChange={e => {
                   const next = { ...overrides }; delete next[pattern];
                   next[e.target.value] = name; onOverrides(next);
                 }}
                 className="flex-1 min-w-0 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-mono uppercase" />
          <select aria-label={`Institution for ${pattern}`} value={name}
                  onChange={e => onOverrides({ ...overrides, [pattern]: e.target.value })}
                  className="w-24 border border-slate-200 rounded-lg px-1 py-1.5 text-xs bg-white">
            {value.map(i => <option key={i.name} value={i.name}>{i.shortLabel || i.name}</option>)}
          </select>
          <button type="button" aria-label={`Remove mapping ${pattern}`}
                  onClick={() => { const next = { ...overrides }; delete next[pattern]; onOverrides(next); }}
                  className="p-1.5 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onOverrides({ ...overrides, "": value[0]?.name ?? "" })}
              className="w-full py-1.5 rounded-lg border border-dashed border-slate-300 text-xs text-slate-500 hover:border-teal-400 hover:text-teal-600">
        + Add site mapping
      </button>
    </div>
  );
}

function SettingsDrawer({ settings, onSave, extraRates = { perDiemRate: 0, ppcMri: 0, ppcCt: 0, ppcXr: 0 }, onSaveExtraRates, onSaveInstitutions, onClose }) {
  const [s, setS] = useState(settings);
  const [er, setER] = useState(extraRates);
  // The API shape, not the classifier shape: this is what PUT /api/institutions takes.
  // Seeded from the built-ins when the user has never saved a set, so the editor opens
  // showing what the dashboard is actually using rather than an empty list.
  const [insts, setInsts] = useState(() => {
    const list = settings.institutions ?? DEFAULT_INSTITUTIONS;
    // Same whole-set rule the Timeline uses: seed from the legacy scalars only while no
    // row carries a figure, so opening Settings shows what the dashboard is showing.
    const migrated = list.some((i) => Number(i.ytd) > 0);
    return list.map((i) => ({
      name: i.key, label: i.label, shortLabel: i.short, color: i.color,
      ytdWrvu: migrated
        ? Number(i.ytd) || 0
        : Number(i.key === "UM" ? settings.umYTD : i.key === "JHS" ? settings.jhsYTD : 0) || 0,
      isDefault: !!i.isDefault, examCount: i.examCount ?? 0,
    }));
  });
  const [overrides, setOverrides] = useState(settings.siteOverrides ?? {});
  const [saving, setSaving] = useState(false);
  const [instError, setInstError] = useState(null);

  const save = async () => {
    setSaving(true); setInstError(null);
    // Institutions save first and to a real endpoint, so a rejected set (no default, a
    // duplicate name, a removal that would orphan exams) keeps the drawer open with the
    // reason visible instead of closing over a silent failure.
    const problem = await onSaveInstitutions?.(insts, overrides);
    setSaving(false);
    if (problem) { setInstError(problem); return; }
    onSave(s); onSaveExtraRates?.(er); onClose();
  };
  const field = (k, label, sub, step = 1) => (
    <div><label className="text-sm font-medium text-slate-700">{label}</label>{sub && <p className="text-[11px] text-slate-400 mb-1">{sub}</p>}
      <input type="number" step={step} value={s[k]} onChange={e => setS({ ...s, [k]: Number(e.target.value) })} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono mt-1" /></div>
  );
  const erField = (k, label, sub, step = 0.01) => (
    <div><label className="text-sm font-medium text-slate-700">{label}</label>{sub && <p className="text-[11px] text-slate-400 mb-1">{sub}</p>}
      <input type="number" min="0" step={step} value={er[k]} onChange={e => setER({ ...er, [k]: Math.max(0, Number(e.target.value) || 0) })} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono mt-1" /></div>
  );
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-white h-full shadow-xl p-6 overflow-y-auto">
        <div className="flex items-center justify-between mb-5"><h2 className="font-semibold text-lg">Settings</h2><button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><X className="w-4 h-4" /></button></div>
        <div className="space-y-4">
          {field("ratePerWrvu", "Your $/wRVU rate", "FY26 extra-coverage rate ≈ $78")}
          {field("monthlyBenchmark", "Monthly benchmark (1.0 cFTE)", "AAARAD 65th ≈ 578 wRVU")}
          {field("cFTE", "Current clinical FTE", "Scales monthly + annual targets", 0.01)}
          {field("privateMult", "Private vs Medicare multiplier", "Commercial ≈ Medicare × this", 0.05)}
          <div className="pt-2 border-t border-slate-100" />
          <InstitutionsEditor value={insts} overrides={overrides} onChange={setInsts} onOverrides={setOverrides} />
          {instError && (
            <p role="alert" className="text-[11px] text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-2.5 py-2">
              {instError}
            </p>
          )}
          <div className="pt-2 border-t border-slate-100" />
          <div className="text-sm font-semibold text-slate-700 flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 text-amber-600" />Extra-duty pay</div>
          <p className="text-[11px] text-slate-400 -mt-2">Rates used to price extra-duty shifts. Per-diem is a default you can override per shift; PPC pays per exam by modality.</p>
          {erField("perDiemRate", "Per-diem rate ($ / shift)")}
          {erField("ppcMri", "Pay-per-click — MRI ($ / exam)")}
          {erField("ppcCt", "Pay-per-click — CT ($ / exam)")}
          {erField("ppcXr", "Pay-per-click — XR ($ / exam)")}
        </div>
        <div className="mt-6 rounded-xl bg-slate-50 p-3 text-[11px] text-slate-500 leading-relaxed"><strong className="text-slate-700">Your data only:</strong> set each institution&apos;s reported YTD wRVU above, then add your monthly reported baseline in the Timeline tab. Everything here is private to your account.</div>
        <button onClick={save} disabled={saving} className="mt-6 w-full py-2.5 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-60">
          {saving ? "Saving…" : "Save settings"}
        </button>
      </div>
    </div>
  );
}
