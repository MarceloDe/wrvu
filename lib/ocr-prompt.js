// Shared OCR extraction + validation prompt for worklist screenshots.
// Used by the in-app uploader (/api/claude via the dashboard) and the
// token-gated /api/ocr-test endpoint. Single source of truth for the rule.
//
// Validation rule (founder spec):
//   - The image must be a table/worklist whose rows are exams/procedures and
//     that has, at minimum, columns for SITE, PROCEDURE (or exam), and EXAM DATE.
//   - If it is NOT such a table, or the content is not semantically a list of
//     exams/procedures by site + procedure + date, return a gentle refusal.
//   - Extra columns are fine — ignore them.
//   - One object per exam ROW (no aggregation). Capture each exam's own date.

import { CODES } from "./data/cms2026-neuro.js";

export function codesReference() {
  return CODES.map((c) => `${c.cpt}=${c.desc} ${c.con} (${c.wrvu})`).join("; ");
}

export function extractionSystemPrompt() {
  const ref = codesReference();
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
    '  - "cpt": map the procedure to its CPT using this neuro reference; "W PLUS WO CONTRAST" = W/WO, "W CONTRAST"/"W PLUS" = W, "WO CONTRAST"/"WO" = W/O. Reference: ' + ref + ".",
    '  - "modality": one of CT/CTA/MRI/MRA/Add-on.',
    '  - "wrvu_each": the work RVU for that CPT from the reference; if not in the reference use your best estimate and set "estimated": true.',
    '  - "estimated": true if the CPT/wRVU is a guess, else false.',
    "",
    "Map the institution from the site text but keep the raw site too.",
    'Return ONLY JSON in this exact shape: {"valid": true, "exams": [{"site":"UMHC","procedure":"MRI BRAIN W PLUS WO CONTRAST","exam_date":"2026-06-12T18:21:13","cpt":"70553","modality":"MRI","wrvu_each":2.23,"estimated":false}]}',
    "No prose, no markdown — JSON only.",
  ].join("\n");
}

export const extractionUserText =
  "Validate then extract this worklist. One object per exam row, with each exam's own exam_date. JSON only.";
