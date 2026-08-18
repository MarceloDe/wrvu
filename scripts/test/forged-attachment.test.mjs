#!/usr/bin/env node
/**
 * N00c — a hand-constructed attachment must be BLOCKED before any network call.
 *
 * The browser half (forged-attachment.browser.js) runs the REAL guard from the
 * REAL module against attachments built by hand, using the same
 * guard-then-fetch sequence callClaude() uses. This half owns the part the
 * browser cannot assert about itself:
 *
 *   the receiving server's own record of what arrived.
 *
 * Every forged attempt must leave NO trace on the server, and the honest control
 * sends must leave exactly the traces they claim. A guard that threw after the
 * request went out would pass the in-page assertions and fail here.
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
const EVIDENCE = path.join(ROOT, "goals", "evidence", "N00c-pwa-lock-llm-proxy");

// The honest control sends. Anything above this count means a forged attachment
// reached the network.
const EXPECTED_SENDS = 3;

const HTML = `<!doctype html><html><head><meta charset="utf-8"><title>forged attachment</title></head>
<body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>`;

async function main() {
  const bundle = await buildHarnessBundle(path.join(HERE, "forged-attachment.browser.js"));
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
    await page.waitForFunction(() => !!window.__runForgedAttachmentTests, null, { timeout: 20000 });
    const results = await page.evaluate(() => window.__runForgedAttachmentTests());
    for (const result of results) {
      if (!result.ok) failed += 1;
      lines.push(`${result.ok ? "ok  " : "FAIL"} ${result.name}${result.ok ? "" : ` — ${result.error}`}`);
    }
    if (!results.length) {
      lines.push("FAIL the browser suite collected zero cases");
      failed += 1;
    }

    // The network-boundary proof: what did the server actually receive?
    const sends = harness.state.claudeRequests;
    const templates = sends.map((s) => {
      try {
        return JSON.parse(s.raw).template;
      } catch (err) {
        return `unparseable(${err.message})`;
      }
    });
    lines.push("");
    lines.push(`/api/claude requests received by the server: ${sends.length} (expected ${EXPECTED_SENDS})`);
    lines.push(`  templates: ${templates.join(", ") || "(none)"}`);
    if (sends.length !== EXPECTED_SENDS) {
      lines.push(`FAIL ${sends.length - EXPECTED_SENDS} unexpected request(s) crossed the boundary`);
      failed += 1;
    } else {
      lines.push("ok   every forged attachment was refused BEFORE the request; only the honest sends arrived");
    }

    // And nothing that did arrive may carry a server-owned field.
    for (const send of sends) {
      const body = JSON.parse(send.raw);
      const keys = Object.keys(body).sort().join(",");
      lines.push(`  body keys: ${keys}`);
      if (keys !== "attachments,params,template") {
        lines.push(`FAIL a request carried fields outside the contract: ${keys}`);
        failed += 1;
      }
    }

    lines.push("");
    lines.push(`${results.length - results.filter((r) => !r.ok).length}/${results.length} browser cases passed`);
  } finally {
    await browser.close();
    await harness.close();
  }
  const report = [
    "node scripts/test/forged-attachment.test.mjs — N00c forged-attachment gate",
    `browser: ${executablePath}`,
    `run: ${new Date().toISOString()}`,
    "",
    ...lines,
  ].join("\n");
  console.log(report);
  fs.mkdirSync(EVIDENCE, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE, "forged-attachment-blocked.txt"), report + "\n");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("forged-attachment FAILED —", err && err.stack ? err.stack : err);
  process.exit(1);
});
