#!/usr/bin/env node
// N17 — there is exactly one place a wRVU may be written down.
//
// The PWA shipped a 61-code table with prices baked in, duplicated a second time inline
// in NeuroRVU.jsx and a third time seeded into rvu_codes. All three disagreed with CMS
// on 54 of 61 codes, so the same study was worth one number on the phone and another in
// the browser. Deleting them is not enough — the interesting question is what stops the
// next one, because each of those copies was added by someone solving a real problem.
//
// So: no source file outside reference/ may contain a code-to-price mapping. The
// heuristic is deliberately narrow — a five-digit CPT and a plausible wRVU on the same
// line — because a broad one gets muted the first time it cries wolf.
import { pass, fail, walk, rel, ROOT } from "./_lib.mjs";
import { readFileSync } from "node:fs";

// reference/ IS the price table. lib/pricing reads it. The verify scripts and the
// build script quote figures in comments and assertions by necessity.
const ALLOWED = [
  /^reference\//,
  /^lib\/pricing\//,
  /^scripts\/verify\//,
  /^scripts\/reference\//,
  /^scripts\/ops\//,
];

const SUSPECT = [
  // { cpt:"70551", ..., wrvu:1.45 }  — an object literal pairing a code with a price
  /["']?\b\d{5}\b["']?[^\n]{0,120}?\bw?rvu\s*[:=]\s*\d+\.\d+/i,
  // wrvu: 1.45, ... cpt: "70551"  — the same thing written the other way round
  /\bw?rvu\s*[:=]\s*\d+\.\d+[^\n]{0,120}?["']?\b\d{5}\b["']?/i,
];

const files = [...walk("lib"), ...walk("components"), ...walk("app"), ...walk("scripts"), ...walk("tests")];
if (files.length === 0) fail("walked zero source files — the walker is broken");

const hits = [];
let scanned = 0;
for (const f of files) {
  const r = rel(f);
  if (ALLOWED.some((a) => a.test(r))) continue;
  scanned++;
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (line.trim().startsWith("//") || line.trim().startsWith("*")) return;   // prose may cite figures
    if (SUSPECT.some((re) => re.test(line))) hits.push(`${r}:${i + 1}  ${line.trim().slice(0, 110)}`);
  });
}
if (scanned === 0) fail("every file was exempt — the allowlist is swallowing the check");

hits.length
  ? fail(`${hits.length} possible second price table outside reference/`, hits.slice(0, 10))
  : pass(`${scanned} source files scanned; no code-to-price mapping outside reference/`);
