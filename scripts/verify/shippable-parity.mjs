#!/usr/bin/env node
// N03e — the CI gate and the shippability harness must not drift apart.
//
// CI runs each quality step individually so a red build names ONE step (the poison
// harness depends on that resolution). scripts/verify/shippable.mjs runs the same
// steps as one harness, and that is what a Validator invokes on a node branch.
//
// Two lists means two places to forget. The failure mode is silent and expensive:
// someone adds a check to ci.yml, main stays green, and every Validator from then
// on issues PASS against a harness that never ran it. This asserts set equality on
// the VERBATIM ci.yml step names.
//
// Non-vacuous by construction: it fails if ci.yml is missing, if the `checks` job
// has no steps, if the harness declares no steps, or if an EXEMPT entry matches
// nothing (a stale exemption is how a real step quietly disappears from the gate).
import { pass, fail, has, read, ROOT } from "./_lib.mjs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const CI = ".github/workflows/ci.yml";
const HARNESS = "scripts/verify/shippable.mjs";

if (!has(CI)) fail(`${CI} does not exist — there is no gate to be in parity with`);
if (!has(HARNESS)) fail(`${HARNESS} does not exist — INV-ALWAYS-SHIPPABLE has no harness`);

// Steps that are legitimately CI-only: environment setup, and meta-checks that audit
// the suite rather than establish shippability. Anything else in ci.yml MUST also be
// in the harness.
const EXEMPT = [
  "npm ci",
  "ensure chromium",
  "invariant checks are executable",
  "native contract (iOS) is intact",
  "migration journal is complete",
  "shippability parity",
];

// Deliberately not a YAML dependency: this runs before `npm ci` would be meaningful.
const ciSteps = [...read(CI).matchAll(/^\s*-\s*name:\s*(.+?)\s*$/gm)].map((m) => m[1]);
if (ciSteps.length === 0) fail(`parsed zero named steps from ${CI} — the parser is broken or the job is empty`);

// Ask the harness itself, as a subprocess. Importing it would depend on a main-guard
// holding, and a broken guard would make shippable.mjs a silent no-op — the exact
// vacuous pass this file exists to prevent. `--list` cannot no-op: if it stopped
// short-circuiting, the suite would run and this parse would fail loudly.
const listed = spawnSync("node", [join(ROOT, HARNESS), "--list"], { encoding: "utf8", cwd: ROOT });
if (listed.status !== 0) fail(`${HARNESS} --list exited ${listed.status}`, [(listed.stderr || listed.stdout || "").slice(0, 400)]);
let STEPS;
try { STEPS = JSON.parse(listed.stdout); }
catch { fail(`${HARNESS} --list did not print a JSON step list — it may have executed the suite instead of listing it`, [listed.stdout.slice(0, 300)]); }
if (!Array.isArray(STEPS) || STEPS.length === 0) fail(`${HARNESS} declared no steps — the harness would run nothing and pass`);

const ciSet = new Set(ciSteps);
const harnessSet = new Set(STEPS.map((s) => s.ci));
const problems = [];

for (const e of EXEMPT) {
  if (!ciSet.has(e)) problems.push(`STALE EXEMPTION  "${e}" is exempt but no longer exists in ${CI} — remove it, or a real step can hide behind it`);
}
for (const s of ciSteps) {
  if (!harnessSet.has(s) && !EXEMPT.includes(s)) problems.push(`CI ONLY  "${s}" gates PRs but the shippability harness never runs it — every Validator PASS skips it`);
}
for (const s of harnessSet) {
  if (!ciSet.has(s)) problems.push(`HARNESS ONLY  "${s}" is in the harness but not in ${CI} — it does not gate a merge`);
}

problems.length
  ? fail(`${problems.length} drift(s) between ${CI} and ${HARNESS}`, problems)
  : pass(`ci.yml and shippable.mjs agree on all ${harnessSet.size} shippability step(s); ${EXEMPT.length} exemptions all present`);
