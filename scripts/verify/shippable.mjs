#!/usr/bin/env node
// INV-ALWAYS-SHIPPABLE — the PWA still works.
//
// Uses EXIT CODES. Grepping next build output for the compile marker is a weak
// check: that marker prints before type-checking, page-data collection and static
// generation, and a tee pipeline returns tee's status, not the command's.
//
// This list is the SINGLE definition of "the PWA is shippable". CI runs the same
// steps individually so a failure is attributable to one step in the GitHub UI, and
// shippable-parity.mjs asserts the two lists have not drifted. Without that parity
// check the Validator's harness could rot while CI stayed green, which is exactly
// the false-PASS class INV-CHECKS-ACTUALLY-RUN exists to prevent.
//
// iOS is deliberately OUT OF SCOPE until a macOS runner lands (N03d): N20y
// established that rotatedFixtureStillParses fails on the iOS 27 runtime and passes
// 58/58 on the pinned 26.5 — a Vision regression, not a code defect. Gating main on
// it would make the branch unmergeable for an unrelated reason.
import { pass, fail } from "./_lib.mjs";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./_lib.mjs";

// `ci` is the VERBATIM step name in .github/workflows/ci.yml. Parity is asserted on
// these strings, so renaming a CI step without renaming it here fails the build.
export const STEPS = [
  { key: "lint",               ci: "npm run lint",                    cmd: ["npm", "run", "lint"] },
  { key: "typecheck",          ci: "npx tsc --noEmit",                cmd: ["npx", "tsc", "--noEmit"] },
  { key: "redaction",          ci: "npm run test:redaction",          cmd: ["npm", "run", "test:redaction"] },
  { key: "forged-attachment",  ci: "npm run test:forged-attachment",  cmd: ["npm", "run", "test:forged-attachment"] },
  { key: "error-envelope",     ci: "npm run test:error-envelope",     cmd: ["npm", "run", "test:error-envelope"] },
  { key: "route-contracts",    ci: "npm run test:route-contracts",    cmd: ["npm", "run", "test:route-contracts"] },
  { key: "llm-proxy",          ci: "npm run test:llm-proxy-contract", cmd: ["npm", "run", "test:llm-proxy-contract"] },
  { key: "baseline",           ci: "npm run test:baseline",           cmd: ["npm", "run", "test:baseline"] },
  { key: "analytics",          ci: "npm run test:analytics",          cmd: ["npm", "run", "test:analytics"] },
  { key: "extra-duty",         ci: "npm run test:extra-duty",         cmd: ["npm", "run", "test:extra-duty"] },
  { key: "comp-display",       ci: "npm run test:comp-display",       cmd: ["npm", "run", "test:comp-display"] },
  { key: "build",              ci: "next build",                      cmd: ["__next_build__"] },
];

if (process.argv.includes("--list")) {
  console.log(JSON.stringify(STEPS.map((s) => ({ key: s.key, ci: s.ci })), null, 2));
  process.exit(0);
}

// next build needs SOME DATABASE_URL for the driver to construct at import. Locally
// that is .env.local; in CI the workflow supplies a syntactically valid but
// unreachable one. Never require .env.local to exist — that would make this harness
// unrunnable in the very place it is supposed to gate.
const envFile = join(ROOT, ".env.local");
const buildCmd = existsSync(envFile)
  ? ["node", `--env-file=${envFile}`, "./node_modules/.bin/next", "build"]
  : ["npx", "next", "build"];
const buildEnv = existsSync(envFile)
  ? process.env
  : { ...process.env,
      DATABASE_URL: process.env.DATABASE_URL || "postgres://ci:ci@127.0.0.1:5432/ci",
      DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED || "postgres://ci:ci@127.0.0.1:5432/ci" };

const failed = [];
for (const s of STEPS) {
  const cmd = s.cmd[0] === "__next_build__" ? buildCmd : s.cmd;
  const env = s.cmd[0] === "__next_build__" ? buildEnv : process.env;
  const r = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf8", cwd: ROOT, env });
  const ok = r.status === 0;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${s.key}  (exit ${r.status})`);
  if (!ok) failed.push(`${s.key}: exit ${r.status}\n${(r.stderr || r.stdout || "").split("\n").slice(-8).join("\n")}`);
}
failed.length ? fail(`${failed.length}/${STEPS.length} shippability step(s) failed`, failed)
              : pass(`all ${STEPS.length} shippability steps green (PWA; iOS excluded pending N03d)`);
