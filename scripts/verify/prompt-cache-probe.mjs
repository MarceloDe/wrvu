#!/usr/bin/env node
// Prompt-caching probe for the OCR template.
//
// The done_when is specific: `cache_read_input_tokens > 0` on the SECOND
// identical call. That is only observable from a real Anthropic response, so
// this probe makes two real, billed calls through the running proxy and reads
// the `usage` block off each.
//
//   PREVIEW=http://localhost:3111 AUTH="Cookie: __session=…" \
//     node scripts/verify/prompt-cache-probe.mjs
//
// Without PREVIEW/AUTH it exits 78 (blocked, not passed). It never simulates a
// cache hit: no key, no verdict.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const EVIDENCE = resolve(ROOT, "goals/evidence/N00c-pwa-lock-llm-proxy/prompt-cache-probe.txt");

const lines = [];
function log(s) {
  lines.push(s);
  console.log(s);
}
function finish(code) {
  mkdirSync(dirname(EVIDENCE), { recursive: true });
  writeFileSync(EVIDENCE, lines.join("\n") + "\n");
  process.exit(code);
}

log(`# prompt-cache-probe  ${new Date().toISOString()}`);

const PREVIEW = process.env.PREVIEW || "";
const AUTH = process.env.AUTH || "";
if (!PREVIEW || !AUTH) {
  log("BLOCKED: PREVIEW and AUTH are required, and the server needs a real ANTHROPIC_API_KEY.");
  log("  An operator closes this with:");
  log("    node --env-file=.env.local ./node_modules/.bin/next dev -p 3111");
  log('    PREVIEW=http://localhost:3111 AUTH="Cookie: __session=<real Clerk session>" \\');
  log("      node scripts/verify/prompt-cache-probe.mjs");
  log("NOT RUN — this is not a pass.");
  finish(78);
}

const [headerName, ...rest] = AUTH.split(":");
const headers = { "Content-Type": "application/json", [headerName.trim()]: rest.join(":").trim() };

// A 1x1 PNG, as the content block the client's redaction path emits. The point
// of the probe is the cached SYSTEM prefix, not the image.
const PNG = {
  type: "image",
  source: {
    type: "base64",
    media_type: "image/png",
    data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  },
};
const body = JSON.stringify({ template: "ocr", params: {}, attachments: [PNG] });

const usages = [];
for (const attempt of [1, 2]) {
  const res = await fetch(`${PREVIEW}/api/claude`, { method: "POST", headers, body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    log(`call ${attempt}  status=${res.status} code=${json?.error?.code || ""} correlationId=${json?.error?.correlationId || ""}`);
    log("\nRESULT: FAIL — the call did not complete, so caching cannot be observed.");
    finish(1);
  }
  const u = json.usage || {};
  usages.push(u);
  log(
    `call ${attempt}  input=${u.input_tokens ?? "?"} cache_creation=${u.cache_creation_input_tokens ?? 0} ` +
      `cache_read=${u.cache_read_input_tokens ?? 0} output=${u.output_tokens ?? "?"}`,
  );
}

const created = Number(usages[0].cache_creation_input_tokens || 0);
const read = Number(usages[1].cache_read_input_tokens || 0);
const pass = read > 0;
log(`# first call wrote ${created} tokens to the cache; second call read ${read}`);
log(
  pass
    ? "\nRESULT: PASS — cache_read_input_tokens > 0 on the second identical call."
    : "\nRESULT: FAIL — no cache read. Check that the system prefix exceeds the model's minimum cacheable length.",
);
finish(pass ? 0 : 1);
