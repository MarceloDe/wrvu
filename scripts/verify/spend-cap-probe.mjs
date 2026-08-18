#!/usr/bin/env node
// Daily spend-cap probe (INV-SERVER-PROMPTS).
//
//   --direct   Drive the meter against the real Neon branch in $DATABASE_URL:
//              record usage until the per-user daily cap is exhausted and assert
//              checkCap() flips to { allowed: false }. Real database, real rows,
//              no mock.
//   (default)  HTTP mode. Bills a user over the cap through the EDGE path
//              (/api/internal/usage) and then asserts the PWA path (/api/claude)
//              returns 429 daily_cap_reached — i.e. both LLM paths share one
//              budget. Needs a running server and a real Clerk session.
//
// HTTP mode with no credentials exits 78 (blocked, not passed).
//
// Run direct mode with:
//   node --env-file=.env.local scripts/verify/spend-cap-probe.mjs --direct

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const EVIDENCE = resolve(ROOT, "goals/evidence/N00c-pwa-lock-llm-proxy/spend-cap-probe.txt");

const direct = process.argv.slice(2).includes("--direct");
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

log(`# spend-cap-probe  ${new Date().toISOString()}`);
log(`# mode=${direct ? "direct (real Neon llm_usage rows)" : "http"}`);

if (direct) {
  if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
    log("BLOCKED: DATABASE_URL is not set. Run with: node --env-file=.env.local …");
    finish(78);
  }
  const { recordUsage, checkCap, capConfig, estimateCost } = await import("../../lib/usage/meter.js");
  const { dailyCapUsd, inputPerMTok, outputPerMTok } = capConfig();
  const userId = `probe_cap_${randomUUID()}`;
  log(`# dailyCapUsd=${dailyCapUsd} inputPerMTok=${inputPerMTok} outputPerMTok=${outputPerMTok} user=${userId}`);

  let failures = 0;
  const before = await checkCap(userId);
  log(`start    allowed=${before.allowed} remaining=$${before.remaining.toFixed(6)} spent=$${before.spent.toFixed(6)}`);
  if (!before.allowed) {
    failures += 1;
    log("MISMATCH: a fresh user must start under the cap");
  }

  // One 1M-input-token call costs exactly `inputPerMTok` dollars.
  const perCallIn = 1_000_000;
  const perCallOut = 0;
  const perCallCost = estimateCost(perCallIn, perCallOut);
  const needed = Math.ceil(dailyCapUsd / perCallCost);
  log(`# each probe call costs $${perCallCost.toFixed(6)}; ${needed} calls exhaust the cap`);

  let flipped = 0;
  for (let i = 1; i <= needed; i += 1) {
    const row = await recordUsage(userId, "probe:spend-cap", perCallIn, perCallOut);
    const cap = await checkCap(userId);
    log(
      `call ${String(i).padStart(2)}  usageId=${row.id} cost=$${row.costEstimate.toFixed(6)}  ` +
        `spent=$${cap.spent.toFixed(6)} remaining=$${cap.remaining.toFixed(6)} allowed=${cap.allowed}`,
    );
    if (!cap.allowed && !flipped) flipped = i;
  }

  const after = await checkCap(userId);
  if (after.allowed) {
    failures += 1;
    log("MISMATCH: the cap did not fire after the budget was exhausted");
  } else {
    log(`# cap fired at call ${flipped} — the HTTP path returns 429 daily_cap_reached with a correlation id here`);
  }
  if (after.remaining !== 0) {
    failures += 1;
    log(`MISMATCH: remaining should clamp to 0, got ${after.remaining}`);
  }

  // Cross-check: a different user is unaffected (INV-NO-PEER-DATA).
  const other = await checkCap(`probe_cap_${randomUUID()}`);
  if (!other.allowed || other.spent !== 0) {
    failures += 1;
    log("MISMATCH: another user's budget was affected");
  } else {
    log(`isolation  a second user is untouched: allowed=${other.allowed} spent=$${other.spent.toFixed(6)}`);
  }

  log(failures === 0 ? "\nRESULT: PASS — the daily cap fires against real usage rows." : `\nRESULT: FAIL (${failures})`);
  finish(failures === 0 ? 0 : 1);
}

// ------------------------------------------------------------------ HTTP mode
const PREVIEW = process.env.PREVIEW || "";
const AUTH = process.env.AUTH || "";
if (!PREVIEW || !AUTH) {
  log("BLOCKED: PREVIEW and AUTH are required for the HTTP probe.");
  log("  An operator closes this with:");
  log("    node --env-file=.env.local ./node_modules/.bin/next dev -p 3111");
  log('    PREVIEW=http://localhost:3111 AUTH="Cookie: __session=<real Clerk session>" \\');
  log("      node scripts/verify/spend-cap-probe.mjs");
  log("NOT RUN — this is not a pass.");
  finish(78);
}

const [headerName, ...rest] = AUTH.split(":");
const headers = { "Content-Type": "application/json", [headerName.trim()]: rest.join(":").trim() };

// 1. Exhaust the budget through the EDGE path.
let exhausted = false;
for (let i = 1; i <= 20 && !exhausted; i += 1) {
  const res = await fetch(`${PREVIEW}/api/internal/usage`, {
    method: "POST",
    headers,
    body: JSON.stringify({ source: "edge-api:resolve", inputTokens: 1_000_000, outputTokens: 0 }),
  });
  const json = await res.json().catch(() => ({}));
  log(`edge  ${String(i).padStart(2)}  status=${res.status} allowed=${json.allowed} remaining=${json.remaining} code=${json?.error?.code || ""}`);
  if (res.status === 429 || json.allowed === false) exhausted = true;
}

// 2. The PWA path must now refuse, before any upstream call.
const res = await fetch(`${PREVIEW}/api/claude`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    template: "ocr",
    params: {},
    attachments: [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        },
      },
    ],
  }),
});
const json = await res.json().catch(() => ({}));
const pwaCode = json?.error?.code || "";
const pwaCorrelationId = json?.error?.correlationId || "";
log(`pwa   status=${res.status} code=${pwaCode} correlationId=${pwaCorrelationId}`);

const pass = exhausted && res.status === 429 && pwaCode === "daily_cap_reached" && !!pwaCorrelationId;
log(
  pass
    ? "\nRESULT: PASS — edge-path spend exhausted the shared budget and /api/claude returned 429 daily_cap_reached with a correlation id."
    : "\nRESULT: FAIL",
);
finish(pass ? 0 : 1);
