#!/usr/bin/env node
// INV-CHECKS-ACTUALLY-RUN — the meta-check.
//
// Every check in goals/INVARIANTS.yaml and every verify.runtime entry in
// goals/nodes/*.yaml must be able to FAIL. A command that cannot run, or that
// exits 0 when the thing it guards is absent, is a vacuous pass — worse than no
// check, because it manufactures confidence.
//
// Exit 1 on any violation. This script is the reason the suite can be trusted,
// so it must never be the thing that silently passes: it fails if it cannot
// find the registry at all.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const ROOT = process.cwd();
const INV = join(ROOT, "goals/INVARIANTS.yaml");
const NODES = join(ROOT, "goals/nodes");

if (!existsSync(INV)) {
  console.error("FAIL: goals/INVARIANTS.yaml not found — cannot audit the suite.");
  process.exit(1);
}

// Deliberately not a YAML dependency: this must run before any install step.
const cmds = [];
for (const [i, line] of readFileSync(INV, "utf8").split("\n").entries()) {
  const m = line.match(/^\s*cmd:\s*(.+?)\s*$/);
  if (m) cmds.push({ src: "INVARIANTS.yaml", line: i + 1, cmd: m[1] });
}
if (existsSync(NODES)) {
  for (const f of readdirSync(NODES).filter((f) => f.endsWith(".yaml") && !f.startsWith("_"))) {
    const text = readFileSync(join(NODES, f), "utf8");
    let inRuntime = false;
    for (const [i, line] of text.split("\n").entries()) {
      if (/^\s*runtime:\s*$/.test(line)) { inRuntime = true; continue; }
      if (inRuntime && /^\s{0,4}\w[\w-]*:\s*$/.test(line)) { inRuntime = false; continue; }
      const m = line.match(/^\s*-\s*"?(.+?)"?\s*$/);
      if (inRuntime && m) cmds.push({ src: `nodes/${f}`, line: i + 1, cmd: m[1] });
    }
  }
}

if (cmds.length === 0) {
  console.error("FAIL: parsed zero commands. The parser is broken, or the registry is empty.");
  process.exit(1);
}

const problems = [];

for (const c of cmds) {
  const { cmd, src, line } = c;
  const at = `${src}:${line}`;

  // 1. A referenced script must exist.
  for (const m of cmd.matchAll(/(scripts\/[\w/.-]+\.(?:mjs|js|sh))/g)) {
    if (!existsSync(join(ROOT, m[1]))) {
      problems.push(`${at}  MISSING SCRIPT  ${m[1]}  — the check cannot run, so the invariant is fiction`);
    }
  }

  // 2. A referenced npm script must be defined.
  const npm = cmd.match(/\bnpm run ([\w:-]+)/);
  if (npm) {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    if (!pkg.scripts?.[npm[1]]) {
      problems.push(`${at}  MISSING npm SCRIPT  ${npm[1]}  — 'npm run' on an undefined script exits 1, but for the wrong reason`);
    }
  }

  // 3. pnpm --filter with no match exits 0. Verified on pnpm 10.33.1.
  if (/\bpnpm\s+--filter\b/.test(cmd) && !/--fail-if-no-match/.test(cmd)) {
    problems.push(`${at}  VACUOUS  pnpm --filter without --fail-if-no-match exits 0 when the filter matches nothing`);
  }

  // 4. A negated grep against a file that may not exist passes vacuously.
  if (/^\s*!\s*grep/.test(cmd) && !/test -[ef]/.test(cmd)) {
    problems.push(`${at}  VACUOUS  '! grep' passes when the target file is absent — assert existence first (test -f X && ! grep ...)`);
  }

  // 5. A pipeline's exit status is the LAST command's. `x | tee f` hides x's failure.
  if (/\|\s*tee\b/.test(cmd) && !/pipefail/.test(cmd)) {
    problems.push(`${at}  MASKED EXIT  '| tee' returns tee's status, so a failing command still exits 0 — use 'set -o pipefail' or drop the pipe`);
  }

  // 6. A shell variable that no step in the same command sets is empty at expansion time.
  //    --env-file populates the NODE process AFTER the shell has already expanded it.
  for (const m of cmd.matchAll(/\$\{?([A-Z][A-Z0-9_]{2,})\}?/g)) {
    const v = m[1];
    if (["PATH", "HOME", "PWD", "SHELL", "USER"].includes(v)) continue;
    if (!process.env[v] && !new RegExp(`${v}\\s*=`).test(cmd)) {
      problems.push(`${at}  EMPTY VAR  $${v} is unset in this shell and nothing in the command sets it. Note: 'node --env-file' does NOT help — the shell expands the token first`);
    }
  }
}

console.log(`checks-are-executable: examined ${cmds.length} commands`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n`);
  for (const p of problems) console.error("  " + p);
  console.error("\nFAIL — a check that cannot fail is not a check.");
  process.exit(1);
}
console.log("PASS — every check can run and can fail.");
