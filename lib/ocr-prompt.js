// Shared OCR extraction + validation prompt for worklist screenshots.
// Server-owned: reachable ONLY through lib/prompts/registry.js (INV-SERVER-PROMPTS).
// The browser never sends a system prompt; it names the `ocr` template id.
//
// Validation rule (founder spec):
//   - The image must be a table/worklist whose rows are exams/procedures and
//     that has, at minimum, columns for SITE, PROCEDURE (or exam), and EXAM DATE.
//   - If it is NOT such a table, or the content is not semantically a list of
//     exams/procedures by site + procedure + date, return a gentle refusal.
//   - Extra columns are fine — ignore them.
//   - One object per exam ROW (no aggregation). Capture each exam's own date.
//
// Prompt caching: the ~4k-character CPT reference is byte-identical on every
// call, so it is emitted as its own trailing system block carrying a
// cache_control breakpoint. Everything up to and including that block is served
// from Anthropic's prompt cache on the second and later calls, which is
// observable as `usage.cache_read_input_tokens > 0`.

import { TAXONOMY } from "./data/neuro-taxonomy.js";
import PROMPT_PRICES from "../reference/neuro-prompt-prices.json" with { type: "json" };

// The code list handed to the model. It used to read wRVU from a bundled table that
// disagreed with CMS on 54 of 61 codes, so the model was told the wrong prices — and
// this block is the prompt-cache PREFIX, so those wrong numbers were cached and re-sent
// on every call.
//
// The numbers now come from neuro-prompt-prices.json, GENERATED from the reference
// schema by scripts/reference/build-reference.mjs. It is a derived cache, not a second
// source: prompt-cache hits require this string to be byte-identical between calls, so
// it cannot be an async database read, and a per-request query would destroy the cache
// this file exists to exploit. prompt-prices-fresh.mjs fails the build if the generated
// file and the reference schema ever disagree.
//
// A code with no national value is listed WITHOUT a number rather than with a zero:
// telling the model a study is worth 0 invites it to report 0, and a contractor-priced
// study is not worth nothing.
export function codesReference() {
  return TAXONOMY.map((c) => {
    const w = PROMPT_PRICES.prices[c.cpt.replace("+", "")];
    return w === null || w === undefined ? `${c.cpt}=${c.desc} ${c.con}` : `${c.cpt}=${c.desc} ${c.con} (${w})`;
  }).join("; ");
}

// Everything except the code reference. Static, but small enough that it is the
// cache prefix rather than the payload.
export function extractionInstructions() {
  return [
    "You extract radiology productivity from a screenshot of a radiologist's worklist, RIS/PACS list, or signed-studies report.",
    "",
    "STEP 1 — VALIDATE the image. It is VALID only if it is a table whose rows are individual exams/procedures AND it shows, at minimum, a site/facility column, a procedure/exam column, and an exam-date column (header names may vary, e.g. SITE/FACILITY, PROCEDURE/EXAM/STUDY/DESCRIPTION, EXAM DATE/DATE/COMPLETED).",
    "If the image is NOT such a table — e.g. it is prose, an unrelated chart, a financial/scheduling table, a document, a photo, or any content that is not semantically a list of exams/procedures by site + procedure + date — then DO NOT extract anything. Return exactly:",
    '{"valid": false, "reason": "<one gentle sentence telling the user this does not look like an exam worklist with Site, Procedure and Exam Date columns, so it cannot be imported; ask them to upload a worklist/RVU report screenshot>"}',
    "",
    "STEP 2 — If VALID, extract EVERY exam row (one JSON object per row — do NOT aggregate or merge duplicates). Ignore any extra columns you don't need.",
    "For each row capture:",
    '  - "site": the site/facility text shown (e.g. "UMHC").',
    '  - "procedure": the exact procedure/exam text shown (e.g. "MRI BRAIN W PLUS WO CONTRAST").',
    '  - "exam_date": the exam date/time as ISO 8601 "YYYY-MM-DDTHH:mm:ss" (convert 12h AM/PM to 24h; if only a date is shown use T00:00:00). Preserve the date exactly as displayed.',
    '  - "cpt": map the procedure to its CPT using the NEURO CPT REFERENCE at the end of this prompt; "W PLUS WO CONTRAST" = W/WO, "W CONTRAST"/"W PLUS" = W, "WO CONTRAST"/"WO" = W/O.',
    '  - "modality": one of CT/CTA/MRI/MRA/Add-on.',
    '  - "wrvu_each": the work RVU for that CPT from the reference; if not in the reference use your best estimate and set "estimated": true.',
    '  - "estimated": true if the CPT/wRVU is a guess, else false.',
    "",
    "Map the institution from the site text but keep the raw site too.",
    'Return ONLY JSON in this exact shape: {"valid": true, "exams": [{"site":"UMHC","procedure":"MRI BRAIN W PLUS WO CONTRAST","exam_date":"2026-06-12T18:21:13","cpt":"70553","modality":"MRI","wrvu_each":2.23,"estimated":false}]}',
    "No prose, no markdown — JSON only.",
  ].join("\n");
}

// The cached payload: the invariant CPT reference, verbatim, in its own block.
export function codesReferenceBlockText() {
  return "NEURO CPT REFERENCE (cpt=description contrast (wRVU)): " + codesReference() + ".";
}

// Anthropic `system` as content blocks, with the cache breakpoint on the
// reference block. Static — takes no parameters, by construction.
export function extractionSystemBlocks() {
  return [
    { type: "text", text: extractionInstructions() },
    { type: "text", text: codesReferenceBlockText(), cache_control: { type: "ephemeral" } },
  ];
}

export const extractionUserText =
  "Validate then extract this worklist. One object per exam row, with each exam's own exam_date. JSON only.";
