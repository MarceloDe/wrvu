#!/usr/bin/env node
// INV-ALWAYS-SHIPPABLE gate: all THREE deployables must be green.
//
//   1. PWA          project-m6jfw        — this repo: lint + production build
//   2. edge API     neurorvu-edge-api    — separate repo, contract tests
//   3. iOS          neurorvu-ios         — separate repo, build + XCUITest
//
// Only (1) lives here. This script runs what it can reach and reports what it
// cannot as BLOCKED with the exact command that closes it. It exits 78 in that
// case: an unrun check is never reported as a pass.
//
// EDGE_API_DIR / IOS_DIR point it at the other two repos when they are checked
// out locally.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const results = [];

function run(label, cmd, args, cwd) {
  process.stdout.write(`\n=== ${label}: ${cmd} ${args.join(" ")} (cwd ${cwd})\n`);
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", env: process.env });
  const ok = r.status === 0;
  results.push({ label, status: ok ? "pass" : "fail", exit: r.status });
  return ok;
}

function blocked(label, how) {
  results.push({ label, status: "blocked", how });
  process.stdout.write(`\n=== ${label}: BLOCKED — ${how}\n`);
}

// 1. PWA -------------------------------------------------------------------
// `next lint` is interactive when the repo has no ESLint config, and this repo
// has none yet. Configuring it belongs to the INV-NO-SWALLOW lint node, not
// here, so it is reported as blocked rather than skipped silently.
const hasEslint = [".eslintrc", ".eslintrc.json", ".eslintrc.js", "eslint.config.js", "eslint.config.mjs"].some(
  (f) => existsSync(resolve(ROOT, f)),
);
if (hasEslint) run("pwa lint", "npx", ["next", "lint", "--max-warnings=0"], ROOT);
else blocked("pwa lint", "no ESLint config in this repo. Close with: npx next lint (choose Strict), then re-run");
run("pwa build", "npx", ["next", "build"], ROOT);
run("pwa llm-proxy contract", process.execPath, ["scripts/test/llm-proxy-contract.mjs"], ROOT);

// The other two deployables are sibling checkouts of the main working tree, not
// of this git worktree — resolve from the common git dir so a worktree run finds
// them too.
function siblingsRoot() {
  const r = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const common = (r.stdout || "").trim();
  return common ? resolve(common, "../..") : resolve(ROOT, "..");
}
const SIBLINGS = siblingsRoot();

// 2. edge API --------------------------------------------------------------
// neurorvu-edge-api is deployed from neurorvu-ios/api in the current layout.
const edgeCandidates = [
  process.env.EDGE_API_DIR,
  resolve(SIBLINGS, "neurorvu-edge-api"),
  resolve(SIBLINGS, "neurorvu-ios/api"),
].filter(Boolean);
const edgeDir = edgeCandidates.find((d) => existsSync(resolve(d, "package.json")));
if (!edgeDir) {
  blocked(
    "edge api contract tests",
    `neurorvu-edge-api not found in ${edgeCandidates.join(", ")}. Close with: EDGE_API_DIR=<path> pnpm verify:shippable`,
  );
} else {
  const pkg = JSON.parse(readFileSync(resolve(edgeDir, "package.json"), "utf8"));
  if (pkg.scripts?.test) run("edge api contract tests", "npm", ["test"], edgeDir);
  else
    blocked(
      "edge api contract tests",
      `${edgeDir} defines no test script — the edge API has no contract suite yet. Close by adding one (node N00c-edge-usage-cap territory), then re-run`,
    );
}

// 3. iOS -------------------------------------------------------------------
const iosDir = process.env.IOS_DIR || resolve(SIBLINGS, "neurorvu-ios");
if (existsSync(resolve(iosDir, "project.yml"))) {
  run(
    "ios build + tests",
    "xcodebuild",
    [
      "test",
      "-project",
      "NeuroRVU.xcodeproj",
      "-scheme",
      "NeuroRVU",
      "-destination",
      process.env.IOS_DESTINATION || "platform=iOS Simulator,name=iPhone 17",
    ],
    iosDir,
  );
} else {
  blocked(
    "ios build + tests",
    `neurorvu-ios is not checked out at ${iosDir}. Close with: IOS_DIR=<path> pnpm verify:shippable`,
  );
}

// --------------------------------------------------------------------------
process.stdout.write("\n=== summary\n");
for (const r of results) {
  process.stdout.write(`${r.status.toUpperCase().padEnd(8)} ${r.label}${r.how ? ` — ${r.how}` : ""}\n`);
}
const failed = results.filter((r) => r.status === "fail");
const blockedOnes = results.filter((r) => r.status === "blocked");
if (failed.length) process.exit(1);
if (blockedOnes.length) {
  process.stdout.write(`\n${blockedOnes.length} deployable(s) could not be verified from this checkout. NOT a pass.\n`);
  process.exit(78);
}
process.exit(0);
