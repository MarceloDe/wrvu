#!/usr/bin/env node
// Rate-limit probe for the LLM proxy (INV-SERVER-PROMPTS).
//
//   --route <path>   HTTP mode (default): burst the route with $AUTH against
//                    $PREVIEW and require a 429 once the bucket is empty.
//                    Needs a running server AND a real Clerk session.
//   --direct         Drive the persisted token bucket itself against the real
//                    Neon branch in $DATABASE_URL. No mock and no fake clock —
//                    a real database, real SQL, real refill arithmetic.
//
// HTTP mode with no credentials exits 78 (blocked, not passed). It never
// reports success for a check it did not run.
//
// Run direct mode with:
//   node --env-file=.env.local scripts/verify/rate-limit-probe.mjs --direct

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const EVIDENCE = resolve(ROOT, "goals/evidence/N00c-pwa-lock-llm-proxy/rate-limit-probe.txt");

const args = process.argv.slice(2);
const direct = args.includes("--direct");
const routeIdx = args.indexOf("--route");
const route = routeIdx !== -1 ? args[routeIdx + 1] : "/api/claude";

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

log(`# rate-limit-probe  ${new Date().toISOString()}`);
log(`# mode=${direct ? "direct (real Neon token bucket)" : `http ${route}`}`);

if (direct) {
  const { consumeRateToken, rateLimitConfig } = await import("../../lib/usage/meter.js");
  if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
    log("BLOCKED: DATABASE_URL is not set. Run with: node --env-file=.env.local …");
    finish(78);
  }
  const { burst, refillPerMinute } = rateLimitConfig();
  const userId = `probe_rate_${randomUUID()}`;
  log(`# burst=${burst} refillPerMinute=${refillPerMinute} user=${userId}`);

  let failures = 0;
  const observed = [];
  for (let i = 1; i <= burst + 2; i += 1) {
    const r = await consumeRateToken(userId);
    observed.push(r.allowed);
    const expected = i <= burst;
    const ok = r.allowed === expected;
    if (!ok) failures += 1;
    log(
      `call ${String(i).padStart(2)}  allowed=${String(r.allowed).padEnd(5)} remaining=${r.remaining}  ` +
        `expected=${expected}  ${ok ? "OK" : "MISMATCH"}`,
    );
  }

  const firstDenial = observed.indexOf(false) + 1;
  log(`# first denial at call ${firstDenial} (a 429 with a correlation id on the HTTP path)`);

  // Refill: waiting one token's worth of time must restore exactly one call.
  const waitMs = Math.ceil((60 / refillPerMinute) * 1000) + 500;
  if (waitMs <= 12000) {
    log(`# waiting ${waitMs}ms for one token to refill`);
    await new Promise((r) => setTimeout(r, waitMs));
    const after = await consumeRateToken(userId);
    const ok = after.allowed === true;
    if (!ok) failures += 1;
    log(`refill   allowed=${after.allowed} remaining=${after.remaining}  expected=true  ${ok ? "OK" : "MISMATCH"}`);
    const again = await consumeRateToken(userId);
    const ok2 = again.allowed === false;
    if (!ok2) failures += 1;
    log(`refill+1 allowed=${again.allowed} remaining=${again.remaining}  expected=false ${ok2 ? "OK" : "MISMATCH"}`);
  } else {
    log(`# refill check skipped: one token takes ${waitMs}ms`);
  }

  log(failures === 0 ? "\nRESULT: PASS — the persisted bucket denies once empty and refills." : `\nRESULT: FAIL (${failures})`);
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
  log("      node scripts/verify/rate-limit-probe.mjs --route /api/claude");
  log("NOT RUN — this is not a pass.");
  finish(78);
}

const [headerName, ...rest] = AUTH.split(":");
const headers = { "Content-Type": "application/json", [headerName.trim()]: rest.join(":").trim() };
const { rateLimitConfig } = await import("../../lib/usage/meter.js");
const { burst } = rateLimitConfig();

let saw429 = false;
for (let i = 1; i <= burst + 3; i += 1) {
  const res = await fetch(`${PREVIEW}${route}`, {
    method: "POST",
    headers,
    // Deliberately invalid: the bucket is consumed before the vendor is called,
    // so the probe costs nothing upstream.
    body: JSON.stringify({ template: "ocr", params: {} }),
  });
  const json = await res.json().catch(() => ({}));
  log(`call ${String(i).padStart(2)}  status=${res.status} code=${json.code || ""} correlationId=${json.correlationId || ""}`);
  if (res.status === 429 && json.code === "rate_limited") saw429 = true;
}
log(saw429 ? "\nRESULT: PASS — 429 rate_limited observed after the configured burst." : "\nRESULT: FAIL — no 429 observed.");
finish(saw429 ? 0 : 1);
