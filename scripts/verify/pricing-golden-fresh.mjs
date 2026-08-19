#!/usr/bin/env node
// INV-PARITY — the shared oracle must still be what the TypeScript engine says.
//
// contracts/pricing-golden.json is the file the Swift tests assert against. If it drifts
// from the engine, the two implementations "agree" on a stale answer and the parity check
// becomes a ritual. That is a worse failure than disagreement, because it looks green.
import { pass, fail, pending, has, read, ROOT } from "./_lib.mjs";
import { join } from "node:path";

const GOLDEN = "contracts/pricing-golden.json";
if (!has(GOLDEN)) fail(`${GOLDEN} does not exist — run scripts/contracts/build-pricing-golden.mjs`);
const golden = JSON.parse(read(GOLDEN));
if (!golden.vectors?.length) fail("the golden file contains no vectors");

if (!process.env.DATABASE_URL && !process.env.DATABASE_URL_UNPOOLED) {
  pending("no database URL, so the engine cannot be consulted", "run with --env-file=.env.local");
}
process.env.DATABASE_URL = process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED;

let resolveMany;
try { ({ resolveMany } = await import(join(ROOT, "lib/pricing/resolve-value.ts"))); }
catch (e) { fail(`could not load the pricing engine: ${e.message}`); }

let live;
try { live = await resolveMany(golden.vectors.map((v) => ({ hcpcs: v.cpt }))); }
catch (e) { pending(`the reference database is unreachable (${String(e.message).slice(0, 70)})`, "DATABASE_URL points at a loaded reference schema"); }

const problems = [];
golden.vectors.forEach((v, i) => {
  const now = live[i];
  if (now.state !== v.priceState) problems.push(`${v.cpt}  state ${now.state} != golden ${v.priceState}`);
  const a = now.workRvu, b = v.workRvu;
  if (a === null && b === null) return;
  if (a === null || b === null || Math.abs(a - b) > 0.005) problems.push(`${v.cpt}  workRvu ${a} != golden ${b}`);
});

// Every state the client must handle should be represented, or the Swift test can pass
// while never exercising the case most likely to be wrong.
const states = new Set(golden.vectors.map((v) => v.priceState));
for (const required of ["priced", "no_physician_work", "contractor_priced", "not_payable", "unknown_code"]) {
  if (!states.has(required)) problems.push(`no vector covers price_state "${required}" — the parity test would never exercise it`);
}

problems.length
  ? fail(`${problems.length} disagreement(s) between the golden vectors and the engine`, problems.slice(0, 12))
  : pass(`all ${golden.vectors.length} golden vectors match the engine, covering ${states.size} price states`);
