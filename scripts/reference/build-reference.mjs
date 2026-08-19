#!/usr/bin/env node
// Derive the ONE reference artifact both apps will price from.
//
// Input is the CMS RVU26A clean dataset — 6.6 MB, byte-identical in
// ~/projects/wrvus and in the iOS bundle (sha256 2e2a4907…). Too fat and too noisy to
// commit, so this emits a slim projection plus a manifest recording the source hash,
// which makes the derivation reproducible and auditable rather than a mystery blob.
//
// THE POINT OF THIS FILE IS THE price_state COLUMN.
//
// Today three completely different facts are all stored as the number 0:
//   * a TECHNICAL COMPONENT row, where zero physician work is the correct answer
//   * a STATUS C row, where CMS publishes no national value because the contractor
//     prices it — showing 0 UNDERSTATES what the radiologist is actually paid
//   * a NOT-PAYABLE row (I, N, X, B, E), which is not a price at all
// The old 61-code table papered over the middle case by inventing numbers (1.43–2.2)
// and flagging them est:true, which is an estimate presented as fact. Both failures
// disappear once the state is named and work_rvu is NULL when there is no value.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

const SOURCES = [
  "../neurorvu-ios/NeuroRVU/Reference/Resources/rvu26a.jsonl",
  process.env.HOME + "/projects/wrvus/radiology_wrvu_2026_clean.jsonl",
];
const src = SOURCES.find(existsSync);
if (!src) { console.error(`FAIL  no CMS source found. Looked in:\n  ${SOURCES.join("\n  ")}`); process.exit(1); }

const raw = readFileSync(src, "utf8");
const sourceSha = createHash("sha256").update(raw).digest("hex");
const rows = raw.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
if (rows.length === 0) { console.error("FAIL  parsed zero rows"); process.exit(1); }

const NOT_PAYABLE = new Set(["I", "N", "X", "B", "E"]);

function priceState(r) {
  const work = Number(r.work_rvu ?? 0);
  if (r.status_code === "C") return "contractor_priced";      // no national value exists
  if (work > 0) return "priced";
  if (NOT_PAYABLE.has(r.status_code)) return "not_payable";
  if (r.status_code === "A" || r.modifier === "TC") return "no_physician_work";
  return "unpriced_other";                                    // R, M, J with zero work
}

const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

const slim = rows.map((r) => {
  const state = priceState(r);
  return {
    hcpcs: r.hcpcs_code,
    modifier: r.modifier || "",
    // NULL, not 0, wherever there is no national work value. This is the whole point.
    work_rvu: state === "priced" || state === "no_physician_work" ? Number(r.work_rvu ?? 0) : null,
    price_state: state,
    status_code: r.status_code,
    pctc_indicator: r.pctc_indicator ?? null,
    global_days: r.global_days ?? null,
    facility_pe_rvu: num(r.facility_pe_rvu),
    non_facility_pe_rvu: num(r.non_facility_pe_rvu),
    malpractice_rvu: num(r.malpractice_rvu),
    conversion_factor: num(r.conversion_factor_non_qp),
    descriptor: r.procedure_name ?? null,      // D14-v3: descriptors stay
    modality: r.modality ?? null,
    body_region: r.body_region ?? null,
    contrast_status: r.contrast_status ?? null,
  };
});

// Refuse to emit anything the loader would silently mangle.
const keys = new Set(slim.map((s) => `${s.hcpcs}|${s.modifier}`));
if (keys.size !== slim.length) { console.error(`FAIL  ${slim.length - keys.size} duplicate (hcpcs, modifier) key(s)`); process.exit(1); }
const bad = slim.filter((s) => s.price_state === "priced" && !(s.work_rvu > 0));
if (bad.length) { console.error(`FAIL  ${bad.length} row(s) marked priced with no work RVU`); process.exit(1); }
const leaked = slim.filter((s) => s.price_state !== "priced" && s.price_state !== "no_physician_work" && s.work_rvu !== null);
if (leaked.length) { console.error(`FAIL  ${leaked.length} unpriced row(s) still carry a number`); process.exit(1); }

const body = slim.map((s) => JSON.stringify(s)).join("\n") + "\n";
writeFileSync("reference/rvu2026a.slim.jsonl", body);

const counts = slim.reduce((a, s) => ((a[s.price_state] = (a[s.price_state] || 0) + 1), a), {});
const manifest = {
  source_release: rows[0].source_release ?? "RVU26A",
  source_file: rows[0].source_file ?? null,
  source_url: rows[0].source_url ?? null,
  source_year: rows[0].source_year ?? 2026,
  source_sha256: sourceSha,
  conversion_factor: num(rows[0].conversion_factor_non_qp),
  rows: slim.length,
  distinct_hcpcs: new Set(slim.map((s) => s.hcpcs)).size,
  price_states: counts,
  slim_sha256: createHash("sha256").update(body).digest("hex"),
  generated_from: src.replace(process.env.HOME, "~"),
};
writeFileSync("reference/manifest.json", JSON.stringify(manifest, null, 2) + "\n");

console.log(`  source            ${src.replace(process.env.HOME, "~")}`);
console.log(`  source sha256     ${sourceSha.slice(0, 24)}…`);
console.log(`  rows              ${manifest.rows}  (${manifest.distinct_hcpcs} distinct HCPCS)`);
console.log(`  price states      ${JSON.stringify(counts)}`);
console.log(`  conversion factor ${manifest.conversion_factor}`);
console.log(`  -> reference/rvu2026a.slim.jsonl  (${(body.length / 1e6).toFixed(2)} MB)`);
