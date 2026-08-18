#!/usr/bin/env node
// Deliberately break ONE check, and prove CI goes red AT THAT STEP.
//
// A green CI proves the happy path. It does not prove the checks are wired to the
// gate — a workflow whose steps all silently succeed looks identical. Poison is how
// you find out.
//
// Branches and PRs are LEFT OPEN. An earlier draft closed and deleted them in
// teardown, which destroyed the only evidence a Validator could re-derive.
import { pass, fail, pending, has, ROOT } from "./_lib.mjs";
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const name = arg("--name"), out = arg("--out");
const base = arg("--base") || "ci/N03-prove-tooling";
if (!name) fail("usage: poison.mjs --name <lint|typecheck|redaction|zerotests> [--base BRANCH] --out FILE");
if (!has(".github/workflows/ci.yml")) pending("no CI workflow exists, so there is no run to poison", "N03 lands .github/workflows/ci.yml");

// Poison content must fail at ONE named step and nowhere earlier. It also must not
// break `next build`: if branch protection ever fails open and a poison merges, a
// broken production build is a far worse outcome than a red check. Everything below
// lives under scripts/, which `npm run lint` covers and `next build` does not compile.
const POISONS = {
  lint:      { step: "npm run lint",                 file: "scripts/poison-lint.js",  body: "// poison: empty catch violates no-empty with allowEmptyCatch:false\ntry { JSON.parse('{}'); } catch (e) {}\n" },
  typecheck: { step: "npx tsc --noEmit",             file: "scripts/poison-type.ts",  body: "// poison: a type error tsc must reject\nexport const n: number = \"not a number\";\n" },
  // Not a marker file: this REPLACES the harness so it collects nothing. On a suite
  // without a minimum-case floor this poison goes GREEN with "0/0 passed". That
  // contrast IS the check — it is INV-CHECKS-ACTUALLY-RUN applied to the test suite
  // that guards the redaction control.
  zerotests: {
    step: "npm run test:redaction",
    file: "scripts/test/redaction.browser.js",
    transform: (src) => src.replace(/window\.__runRedactionTests\s*=\s*/, "window.__runRedactionTests = () => []; window.__unused = "),
  },
};
const p = POISONS[name];
if (!p) fail(`unknown poison '${name}'. Known: ${Object.keys(POISONS).join(", ")}`);
const expectStep = arg("--expect-step") || p.step;

const sh = (c) => execSync(c, { cwd: ROOT, encoding: "utf8" }).trim();
const branch = `poison/N03-${name}`;

// Idempotent: a re-deriving Validator must not abort because the branch or PR exists.
try { sh(`git rev-parse --verify origin/${branch}`); sh(`git push origin --delete ${branch}`); } catch {}
sh(`git fetch -q origin ${base}`);
const prev = sh("git rev-parse --abbrev-ref HEAD");
sh(`git checkout -q -B ${branch} origin/${base}`);
try {
  const f = join(ROOT, p.file);
  mkdirSync(dirname(f), { recursive: true });
  if (p.transform) {
    if (!existsSync(f)) fail(`poison(${name}) transforms ${p.file}, which does not exist`);
    const before = execSync(`cat ${JSON.stringify(f)}`, { encoding: "utf8" });
    const after = p.transform(before);
    if (after === before) fail(`poison(${name}) transform matched nothing in ${p.file} — it would produce a GREEN run and prove nothing`);
    writeFileSync(f, after);
  } else {
    writeFileSync(f, p.body);
  }
  sh(`git add -- ${p.file}`);
  sh(`git -c user.name=poison -c user.email=poison@local commit -q -m "poison(${name}): must fail at '${expectStep}'"`);
  sh(`git push -q -u origin ${branch}`);
} finally { sh(`git checkout -q ${prev}`); }

const sha = sh(`git rev-parse origin/${branch}`);
try { sh(`gh pr create --draft --base main --head ${branch} --title "poison(${name}) — DO NOT MERGE" --body "Deliberately red. Proves CI fails at '${expectStep}'. Left open: closing it destroys the evidence."`); }
catch { /* already exists */ }

execSync(`node ${join(ROOT, "scripts/verify/gh-wait-run.mjs")} --branch ${branch} --sha ${sha} --out /tmp/poison-${name}.json`, { stdio: "inherit" });
const run = JSON.parse(execSync(`cat /tmp/poison-${name}.json`, { encoding: "utf8" }));
const steps = run.jobs[0]?.steps ?? [];
const failed = steps.find((s) => s.conclusion === "failure");
const result = { name, expectedStep: expectStep, failedStep: failed?.name ?? null, conclusion: run.conclusion, runId: run.databaseId, branch, prLeftOpen: true };
if (out) writeFileSync(join(ROOT, out), JSON.stringify(result, null, 2));

if (run.conclusion !== "failure") fail(`poison(${name}) run ${run.databaseId} concluded '${run.conclusion}' — the check is not wired to the gate`);
if (failed?.name !== expectStep) fail(`poison(${name}) went red at '${failed?.name}', expected '${expectStep}' — it broke something other than the step under test`);
pass(`poison(${name}) went RED at '${expectStep}' (run ${run.databaseId}); branch and PR left open`);
