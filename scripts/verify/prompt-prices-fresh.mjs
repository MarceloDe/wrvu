#!/usr/bin/env node
// reference/neuro-prompt-prices.json is a CACHE of the reference schema, not a source.
//
// The OCR prompt is Anthropic's cache PREFIX: cache hits require the string to be
// byte-identical between calls, so it has to be a synchronous constant. A per-request
// database read would destroy the very cache that block exists to exploit. So the
// numbers are generated at build time — and a generated cache that nobody re-checks is
// exactly how the last duplicate table drifted 54 codes away from CMS.
//
// This fails the build if the generated file and the reference artifact disagree, or if
// it was generated from a different CMS release than the one currently shipping.
import { pass, fail, has, read } from "./_lib.mjs";

const GEN = "reference/neuro-prompt-prices.json";
const SLIM = "reference/rvu2026a.slim.jsonl";
const MANIFEST = "reference/manifest.json";
const TAX = "lib/data/neuro-taxonomy.js";
for (const f of [GEN, SLIM, MANIFEST, TAX]) if (!has(f)) fail(`${f} does not exist`);

const gen = JSON.parse(read(GEN));
const manifest = JSON.parse(read(MANIFEST));
if (gen.source_sha256 !== manifest.source_sha256) {
  fail("the prompt prices were generated from a different CMS release than the one shipping",
       [`generated from ${gen.source_sha256.slice(0, 16)}…`, `manifest says  ${manifest.source_sha256.slice(0, 16)}…`,
        "run: node scripts/reference/build-reference.mjs"]);
}

const best = new Map();
for (const line of read(SLIM).split("\n")) {
  if (!line.trim()) continue;
  const r = JSON.parse(line);
  if (r.modifier === "TC") continue;
  if (best.has(r.hcpcs) && r.modifier !== "26") continue;
  best.set(r.hcpcs, r);
}
if (best.size === 0) fail("parsed zero rows from the reference artifact");

const codes = [...read(TAX).matchAll(/cpt:\s*"([^"]+)"/g)].map((m) => m[1].replace("+", ""));
if (codes.length === 0) fail(`parsed zero codes from ${TAX}`);

const problems = [];
for (const cpt of codes) {
  const want = best.has(cpt) ? best.get(cpt).work_rvu : null;
  const got = Object.prototype.hasOwnProperty.call(gen.prices, cpt) ? gen.prices[cpt] : undefined;
  if (got === undefined) { problems.push(`${cpt} is in the taxonomy but missing from the prompt prices`); continue; }
  if (want === null && got !== null) problems.push(`${cpt} has no national work RVU but the prompt tells the model ${got}`);
  else if (want !== null && (got === null || Math.abs(Number(got) - Number(want)) > 0.005)) problems.push(`${cpt} prompt says ${got}, reference says ${want}`);
}
for (const cpt of Object.keys(gen.prices)) {
  if (!codes.includes(cpt)) problems.push(`${cpt} is in the prompt prices but no longer in the taxonomy`);
}

problems.length
  ? fail(`${problems.length} disagreement(s) between the OCR prompt's prices and the reference`, problems.slice(0, 10))
  : pass(`the OCR prompt's ${codes.length} prices match the reference (${gen.source_release}), and the model is told nothing for the ${codes.filter((c) => gen.prices[c] === null).length} code(s) CMS does not price`);
