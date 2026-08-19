#!/usr/bin/env node
// Modality decides which PPC bucket a study is PAID from. It may not be guessed.
//
// PPC_BUCKET was always correct — an unrecognised modality falls to "other", which is not
// paid. The defect was every call site defaulting to "CT" first, so nothing was ever
// unrecognised and every unknown study was paid at the CT rate. In the July rate snapshot
// that is $150 instead of $50 per study.
//
// Nothing had realised that cost yet (measured: 6 of 887 exams mis-classified, none of
// them inside a paid PPC bundle). It was going to, the first time a real X-ray bundle was
// uploaded — CMS recognises 236 XR codes and the old neuro table contained none.
import { pass, fail, has, read } from "./_lib.mjs";

const FILE = "components/NeuroRVU.jsx";
if (!has(FILE)) fail(`${FILE} does not exist`);
const src = read(FILE);

// The paid buckets, per PPC_BUCKET: anything matching MR* or CT* is billable.
const PAID = /\|\|\s*["'](CT|CTA|MR|MRI|MRA)["']/g;
const hits = [];
src.split("\n").forEach((line, i) => {
  if (line.trim().startsWith("//")) return;
  for (const m of line.matchAll(PAID)) {
    hits.push(`${FILE}:${i + 1}  defaults an unknown modality to "${m[1]}", a PAID PPC bucket — use "Other"\n        ${line.trim().slice(0, 100)}`);
  }
});

// And the bucket function itself must still fail closed.
const bucket = src.match(/const PPC_BUCKET[\s\S]*?\n};/);
if (!bucket) fail("PPC_BUCKET not found — the parser is broken or the pay mapping moved");
if (!/return "other";/.test(bucket[0])) hits.push("PPC_BUCKET no longer falls back to the unpaid \"other\" bucket");

hits.length
  ? fail(`${hits.length} place(s) guess a modality into a paid bucket`, hits)
  : pass(`no modality is guessed into a paid bucket, and PPC_BUCKET still fails closed to "other"`);
