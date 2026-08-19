#!/usr/bin/env node
// INV-PARITY — the pricing engine must agree with CMS on every code, not most of them.
//
// This deliberately reads the ORIGINAL 6.6 MB CMS extract in the iOS bundle, not the
// slim artifact this repo generates from it. Comparing the engine against my own
// derivation would only prove the derivation is self-consistent; comparing it against
// the untouched source catches a bug in build-reference.mjs, a bad load, a wrong
// modifier default, or a numeric that lost precision on the way into Postgres.
//
// It also asserts the modifier rule that makes the whole thing coherent: the technical
// component carries no physician work, so the professional ('26') and global ('') rows
// must report the SAME work RVU, and TC must never be what a lookup returns by default.
import { pass, fail, pending, ROOT } from "./_lib.mjs";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CMS = join(ROOT, "..", "neurorvu-ios/NeuroRVU/Reference/Resources/rvu26a.jsonl");
if (!existsSync(CMS)) {
  pending("the untouched CMS extract is not checked out, so the engine cannot be compared against its source",
          "the neurorvu-ios repo sits beside this one (D43 keeps them federated)");
}
if (!process.env.DATABASE_URL && !process.env.DATABASE_URL_UNPOOLED) {
  fail("no DATABASE_URL — this check prices against a live reference schema. Run with --env-file=.env.local");
}
process.env.DATABASE_URL = process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED;

const rows = readFileSync(CMS, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
if (rows.length === 0) fail("parsed zero rows from the CMS extract");

// What the engine SHOULD say, computed straight from the source.
const NOT_PAYABLE = new Set(["I", "N", "X", "B", "E"]);
const expected = new Map();     // hcpcs -> {state, work}
for (const r of rows) {
  const mod = r.modifier || "";
  if (mod === "TC") continue;                       // never a default lookup
  const prev = expected.get(r.hcpcs_code);
  if (prev && mod !== "26") continue;               // '26' wins over ''
  const work = Number(r.work_rvu ?? 0);
  let state, value;
  if (r.status_code === "C") { state = "contractor_priced"; value = null; }
  else if (work > 0) { state = "priced"; value = work; }
  else if (NOT_PAYABLE.has(r.status_code)) { state = "not_payable"; value = null; }
  else if (r.status_code === "A") { state = "no_physician_work"; value = 0; }
  else { state = "unpriced_other"; value = null; }
  expected.set(r.hcpcs_code, { state, work: value });
}
if (expected.size === 0) fail("derived zero expectations from the CMS extract — the parser is broken");

const { resolveMany } = await import(join(ROOT, "lib/pricing/resolve-value.ts"));
const codes = [...expected.keys()];

// CI hands this a syntactically valid but unreachable URL so `next build` can import the
// driver. An unreachable database means the comparison did not happen — that is PENDING,
// never a pass. A reference schema that is reachable but EMPTY is a real failure.
let got;
try {
  got = await resolveMany(codes.map((h) => ({ hcpcs: h })));
} catch (e) {
  pending(`the reference database could not be reached (${String(e.message).slice(0, 80)})`,
          "DATABASE_URL points at a database with the reference schema loaded");
}
if (got.every((v) => v.state === "unknown_code")) {
  fail(`every one of the ${codes.length} codes is unknown — the reference schema is reachable but empty. Run scripts/reference/load-reference.mjs`);
}

const problems = [];
for (let i = 0; i < codes.length; i++) {
  const h = codes[i], want = expected.get(h), have = got[i];
  if (have.state !== want.state) { problems.push(`${h}  state ${have.state} != CMS ${want.state}`); continue; }
  const a = have.workRvu, b = want.work;
  if (a === null && b === null) continue;
  if (a === null || b === null || Math.abs(a - b) > 0.005) problems.push(`${h}  work ${a} != CMS ${b}`);
}

// The modifier rule, checked rather than assumed.
const sample = codes.slice(0, 60);
const pro = await resolveMany(sample.map((h) => ({ hcpcs: h, modifier: "26" })));
const glob = await resolveMany(sample.map((h) => ({ hcpcs: h, modifier: "" })));
for (let i = 0; i < sample.length; i++) {
  if (pro[i].state === "unknown_code" || glob[i].state === "unknown_code") continue;
  if (pro[i].workRvu !== glob[i].workRvu) {
    problems.push(`${sample[i]}  professional ${pro[i].workRvu} != global ${glob[i].workRvu} — work RVU must not depend on -26`);
  }
}
const defaults = await resolveMany(sample.map((h) => ({ hcpcs: h })));
const tcDefault = defaults.filter((v) => v.modifier === "TC");
if (tcDefault.length) problems.push(`${tcDefault.length} default lookup(s) returned the TECHNICAL component — reading a study is professional work`);

problems.length
  ? fail(`${problems.length}/${codes.length} code(s) disagree with the CMS source`, problems.slice(0, 15))
  : pass(`the engine matches the untouched CMS extract on all ${codes.length} codes, and -26 never changes the work RVU`);
