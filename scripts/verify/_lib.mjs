// Shared contract for every verification script.
//
// THREE outcomes, not two. A check whose SUBJECT does not exist yet must not
// exit 0 — that is the vacuous pass INV-CHECKS-ACTUALLY-RUN forbids. It exits
// PENDING (78), which is visibly not-a-pass, names what must exist first, and
// flips to a real check the moment its subject lands.
//
//   0   PASS     the rule was evaluated and holds
//   1   FAIL     the rule was evaluated and is violated
//  78   PENDING  the rule could not be evaluated; its subject does not exist yet
//
// CI treats 78 as neither green nor red: it is reported, counted, and must
// shrink over time. It may never be silently swallowed.

export const PASS = 0, FAIL = 1, PENDING = 78;

export function pass(msg) { console.log(`PASS  ${msg}`); process.exit(PASS); }

export function fail(msg, details = []) {
  console.error(`FAIL  ${msg}`);
  for (const d of details) console.error(`        ${d}`);
  process.exit(FAIL);
}

// `becomesActiveWhen` is mandatory: a pending check must say what unblocks it,
// or it is indistinguishable from an abandoned one.
export function pending(msg, becomesActiveWhen) {
  if (!becomesActiveWhen) throw new Error("pending() requires becomesActiveWhen");
  console.log(`PENDING  ${msg}`);
  console.log(`         becomes a real check when: ${becomesActiveWhen}`);
  process.exit(PENDING);
}

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

export const ROOT = process.cwd();
export const has = (p) => existsSync(join(ROOT, p));
export const read = (p) => readFileSync(join(ROOT, p), "utf8");

export function walk(dir, exts = [".js", ".jsx", ".ts", ".tsx", ".mjs"]) {
  const out = [];
  const base = join(ROOT, dir);
  if (!existsSync(base)) return out;
  (function rec(d) {
    for (const e of readdirSync(d)) {
      if (e === "node_modules" || e === ".next" || e.startsWith(".")) continue;
      const p = join(d, e);
      if (statSync(p).isDirectory()) rec(p);
      else if (exts.includes(extname(e))) out.push(p);
    }
  })(base);
  return out;
}

export function rel(p) { return p.replace(ROOT + "/", ""); }
