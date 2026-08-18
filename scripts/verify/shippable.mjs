#!/usr/bin/env node
// INV-ALWAYS-SHIPPABLE — the PWA still works.
//
// Uses EXIT CODES. Grepping next build output for the compile marker is a weak
// check: that marker prints before type-checking, page-data collection and static
// generation, and a tee pipeline returns tee's status, not the command's.
//
// iOS is deliberately OUT OF SCOPE until N20y: rotatedFixtureStillParses fails on
// the iOS 27 runtime and passes 52/52 on 26.5 — a Vision regression, not a code
// defect. Gating main on it would make the branch unmergeable for an unrelated reason.
import { pass, fail } from "./_lib.mjs";
import { spawnSync } from "node:child_process";

const steps = [
  ["lint",             ["npm", "run", "lint"]],
  ["typecheck",        ["npx", "tsc", "--noEmit"]],
  ["redaction",        ["npm", "run", "test:redaction"]],
  ["error-envelope",   ["npm", "run", "test:error-envelope"]],
  ["route-contracts",  ["npm", "run", "test:route-contracts"]],
  ["llm-proxy",        ["npm", "run", "test:llm-proxy-contract"]],
  ["build",            ["node", "--env-file=.env.local", "./node_modules/.bin/next", "build"]],
];
const failed = [];
for (const [name, cmd] of steps) {
  const r = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf8" });
  const ok = r.status === 0;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}  (exit ${r.status})`);
  if (!ok) failed.push(`${name}: exit ${r.status}\n${(r.stderr || r.stdout || "").split("\n").slice(-8).join("\n")}`);
}
failed.length ? fail(`${failed.length}/${steps.length} shippability step(s) failed`, failed)
              : pass(`all ${steps.length} shippability steps green (PWA; iOS excluded pending N20y)`);
