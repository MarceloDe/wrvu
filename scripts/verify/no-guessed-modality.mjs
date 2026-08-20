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
import { pass, fail, has, read, ROOT } from "./_lib.mjs";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// N06 split the dashboard into modules, so scanning one file would now miss most of the
// call sites. Walk the whole client surface instead: a default-to-CT can be reintroduced
// in any of them, and a check that only looks where the bug used to be is worth little.
function sources(dir, out = []) {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) { sources(rel, out); continue; }
    if (/\.(js|jsx|ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}
const FILES = [...sources("components"), ...sources("lib/analytics"), ...sources("lib/data")];
if (FILES.length === 0) fail("no source files found — the walker is broken, not the code");

// The paid buckets, per PPC_BUCKET: anything matching MR* or CT* is billable.
const PAID = /\|\|\s*["'](CT|CTA|MR|MRI|MRA)["']/g;
const hits = [];
for (const file of FILES) {
  read(file).split("\n").forEach((line, i) => {
    if (line.trim().startsWith("//")) return;
    for (const m of line.matchAll(PAID)) {
      hits.push(`${file}:${i + 1}  defaults an unknown modality to "${m[1]}", a PAID PPC bucket — use "Other"\n        ${line.trim().slice(0, 100)}`);
    }
  });
}

// The bucket function itself must still exist, in exactly ONE place, and fail closed.
// Two copies would be the same "which one is authoritative" problem the price book had.
const defining = FILES.filter((f) => /(export )?const PPC_BUCKET/.test(read(f)));
if (defining.length === 0) fail("PPC_BUCKET not found — the parser is broken or the pay mapping moved");
if (defining.length > 1) fail(`PPC_BUCKET is defined in ${defining.length} files: ${defining.join(", ")}`);
const bucket = read(defining[0]).match(/(?:export )?const PPC_BUCKET[\s\S]*?\n};/);
if (!bucket) fail(`PPC_BUCKET found in ${defining[0]} but could not be parsed`);
if (!/return "other";/.test(bucket[0])) hits.push(`PPC_BUCKET (${defining[0]}) no longer falls back to the unpaid "other" bucket`);

hits.length
  ? fail(`${hits.length} place(s) guess a modality into a paid bucket`, hits)
  : pass(`${FILES.length} files scanned; no modality is guessed into a paid bucket, and PPC_BUCKET (${defining[0]}) still fails closed to "other"`);
