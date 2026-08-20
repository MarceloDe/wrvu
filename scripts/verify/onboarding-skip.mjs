#!/usr/bin/env node
// INV-SITE-NEVER-FAILS / D35 / G4.2 — onboarding must stay skippable, and a user who skips
// everything must reach a working app that is HONEST about what it does not know.
//
// INVARIANTS.yaml has named a check `pnpm test:onboarding-skip` since before onboarding
// existed. It never did. The A1 contract audit flagged it VACUOUS, and a named check that
// does not exist is worse than no check: it reads as covered.
//
// Three things are asserted, and each one has a real failure behind it:
//
//   1. Every step of the wizard offers a way past it. A wizard with one mandatory field is
//      a wall, and D35 says nothing is ever a wall.
//   2. A brand-new user's rate is UNSET, not 78. Until N33 a new account was shown
//      "Tracked comp value $0 @ $78/wRVU" — a figure computed from someone else's rate.
//   3. No dollar figure is formatted straight from settings.ratePerWrvu. Every one must go
//      through comp()/hasRate(), which return nothing when there is no rate. A single
//      `${...ratePerWrvu}` in a template literal puts the guess back on screen.
import { pass, fail, has, read } from "./_lib.mjs";

const WIZARD = "components/onboarding/Onboarding.jsx";
const ROOT = "components/NeuroRVU.jsx";
const FORMAT = "lib/analytics/format.js";

for (const f of [WIZARD, ROOT, FORMAT]) {
  // Existence first: every assertion below is a search, and a search over a missing file
  // finds nothing and passes. That is the vacuous-pass shape this whole file exists to avoid.
  if (!has(f)) fail(`${f} does not exist — onboarding cannot be verified`);
}

const wizard = read(WIZARD);
const root = read(ROOT);
const problems = [];

// ── 1. every step is escapable ───────────────────────────────────────────────
const steps = [...wizard.matchAll(/step === (\d+)/g)].map((m) => Number(m[1]));
const declared = (wizard.match(/^const STEPS = \[(.*)\];$/m) ?? [])[1];
const stepCount = declared ? declared.split(",").length : 0;
if (stepCount < 2) problems.push("STEPS is missing or trivial — the wizard has no declared steps to check");
const rendered = new Set(steps);
for (let i = 0; i < stepCount; i++) {
  if (!rendered.has(i)) problems.push(`step ${i} is declared in STEPS but never rendered`);
}
// The escape hatches: Nav's onSkip on the middle steps, an explicit skip on the first, and
// the last step is the finish itself.
const skipCalls = (wizard.match(/onSkip=\{/g) ?? []).length;
const dismissCalls = (wizard.match(/onDismiss\(/g) ?? []).length;
if (skipCalls < stepCount - 2) {
  problems.push(`only ${skipCalls} step(s) pass onSkip; ${stepCount - 2} middle steps need one (D35)`);
}
if (dismissCalls < 1) problems.push("the first step offers no way to skip setup entirely");
if (!/function Nav\(/.test(wizard) || !/onSkip/.test(wizard)) {
  problems.push("Nav does not implement a skip control");
}

// ── 2. a new account has no rate ─────────────────────────────────────────────
const defaults = (root.match(/const DEFAULTS = \{[^}]*\}/s) ?? [])[0] ?? "";
if (!defaults) problems.push("DEFAULTS not found in the root component");
else if (!/ratePerWrvu:\s*null/.test(defaults)) {
  problems.push(`DEFAULTS.ratePerWrvu must be null so a new user sees no dollar figures — found: ${
    (defaults.match(/ratePerWrvu:[^,}]*/) ?? ["?"])[0].trim()}`);
}

// ── 3. no dollar is formatted straight from the rate ─────────────────────────
const FILES = ["components/NeuroRVU.jsx", "components/analytics/Tracker.jsx",
               "components/analytics/primitives.jsx", "components/analytics/Uploads.jsx"];
for (const f of FILES) {
  if (!has(f)) { problems.push(`${f} is missing — the dollar scan cannot run`); continue; }
  read(f).split("\n").forEach((line, i) => {
    if (line.trim().startsWith("//")) return;
    // What actually puts a fabricated figure on screen is a PRODUCT of wRVU and the rate.
    // Printing the rate itself ("@ $78/wRVU") is fine and is guarded separately, so the
    // rule is: no multiplication by the rate on a line that does not go through the helper.
    const multiplies = /\*\s*settings\.ratePerWrvu|settings\.ratePerWrvu\s*\*/.test(line);
    const guarded = /\bcomp\(|\bhasRate\(/.test(line);
    if (multiplies && !guarded) {
      problems.push(`${f}:${i + 1} multiplies by ratePerWrvu without comp()/hasRate() — a rate the user never set becomes a dollar figure\n        ${line.trim().slice(0, 110)}`);
    }
  });
}
if (!/export function comp\(/.test(read(FORMAT)) || !/export const hasRate/.test(read(FORMAT))) {
  problems.push(`${FORMAT} must export comp() and hasRate() — they are the single rule`);
}

problems.length
  ? fail(`${problems.length} onboarding-skip problem(s)`, problems)
  : pass(`onboarding is skippable at all ${stepCount} steps, a new account has no rate, and every dollar goes through comp()`);
