#!/usr/bin/env node
/**
 * `npm run test:redaction` — the redaction unit suite.
 *
 * Every case runs against the shipped modules inside a real Chromium: the
 * redaction primitive is a canvas operation, so a simulated canvas would be
 * testing something other than what ships (D20). Nothing here is mocked.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { buildHarnessBundle } from "../verify/harness/bundle.mjs";
import { resolveChromium } from "../verify/harness/chromium.mjs";
import { startHarnessServer } from "../verify/harness/server.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const EVIDENCE = path.join(ROOT, "goals", "evidence", "N00f-redact-before-upload");

const HTML = `<!doctype html><html><head><meta charset="utf-8"><title>redaction unit tests</title></head>
<body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>`;

async function main() {
  const bundle = await buildHarnessBundle(path.join(HERE, "redaction.browser.js"));
  const harness = await startHarnessServer({ bundle, html: HTML });
  const executablePath = resolveChromium();
  const browser = await chromium.launch({ executablePath, headless: true });
  const lines = [];
  let failed = 0;
  try {
    const page = await browser.newPage();
    page.on("pageerror", (err) => {
      lines.push(`page error: ${err.message}`);
      failed += 1;
    });
    await page.goto(`${harness.origin}/`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => !!window.__runRedactionTests, null, { timeout: 20000 });
    const results = await page.evaluate(() => window.__runRedactionTests());
    // INV-CHECKS-ACTUALLY-RUN. Without this floor, a harness that returns [] prints
    // "0/0 passed" and exits 0 — a green build for a suite that ran nothing, guarding
    // the control that stops patient images leaving the device. The number is a FLOOR,
    // not an exact count: adding cases must never require editing this line.
    const MIN_CASES = 25;
    if (!Array.isArray(results) || results.length < MIN_CASES) {
      console.error(`test:redaction FAILED — collected ${Array.isArray(results) ? results.length : "non-array"} case(s), expected at least ${MIN_CASES}. A suite that runs nothing must not report success.`);
      process.exit(1);
    }
    for (const result of results) {
      if (!result.ok) failed += 1;
      lines.push(`${result.ok ? "ok  " : "FAIL"} ${result.name}${result.ok ? "" : ` — ${result.error}`}`);
    }
    lines.push("");
    lines.push(`${results.length - failed}/${results.length} passed`);
  } finally {
    await browser.close();
    await harness.close();
  }
  const report = [
    "npm run test:redaction — N00f redaction unit suite",
    `browser: ${executablePath}`,
    `run: ${new Date().toISOString()}`,
    "",
    ...lines,
  ].join("\n");
  console.log(report);
  fs.mkdirSync(EVIDENCE, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE, "redaction-unit-tests.txt"), report + "\n");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("test:redaction FAILED —", err && err.stack ? err.stack : err);
  process.exit(1);
});
