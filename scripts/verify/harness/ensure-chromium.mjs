#!/usr/bin/env node
// Make sure a real Chromium exists, without ever being able to hang.
//
// CI used to run `npx playwright install --with-deps chromium`. This project depends
// on playwright-core, NOT playwright, so npx cannot resolve a local binary and offers
// to fetch the package instead — "Ok to proceed? (y)" — on a runner with no stdin.
// That is an infinite hang, and it only showed up when the npx cache went cold: run
// 32208571889 sat on that one step for 35 minutes before it was cancelled.
//
// Two changes make it safe. `--yes` answers the prompt, and the version is pinned so
// the browser build matches the playwright-core we test with. And it runs at all only
// when no Chromium is already present — the GitHub runner image ships Google Chrome at
// /usr/bin/google-chrome, which resolveChromium() finds, so the usual path installs
// nothing and costs nothing.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolveChromium } from "./chromium.mjs";

const INSTALL_TIMEOUT_MS = 6 * 60_000;

try {
  console.log(`chromium already present: ${resolveChromium()}`);
  process.exit(0);
} catch {
  console.log("no Chromium found; installing one");
}

// Match the browser build to the client we drive it with.
const pkg = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));
const spec = (pkg.devDependencies?.["playwright-core"] ?? pkg.dependencies?.["playwright-core"] ?? "").replace(/^[\^~]/, "");
if (!spec) { console.error("FAIL  playwright-core is not a dependency, so there is no version to pin the browser to"); process.exit(1); }

const r = spawnSync("npx", ["--yes", `playwright@${spec}`, "install", "--with-deps", "chromium"], {
  stdio: ["ignore", "inherit", "inherit"],   // never inherit stdin: that is the hang
  timeout: INSTALL_TIMEOUT_MS,
});
if (r.error?.code === "ETIMEDOUT" || r.signal) {
  console.error(`FAIL  chromium install exceeded ${INSTALL_TIMEOUT_MS / 60000} minutes and was killed (signal ${r.signal ?? "none"})`);
  process.exit(1);
}
if (r.status !== 0) { console.error(`FAIL  chromium install exited ${r.status}`); process.exit(1); }

try {
  console.log(`chromium installed: ${resolveChromium()}`);
} catch (e) {
  console.error(`FAIL  install reported success but no Chromium is resolvable: ${e.message}`);
  process.exit(1);
}
