#!/usr/bin/env node
// Fault injection against a REAL running server over REAL HTTP. No mocks.
//
//   node scripts/verify/fault-injection.mjs --all-routes
//
// Environment:
//   BASE_URL      server under test           (default http://localhost:3111)
//   PROBE_COOKIE  a real signed-in Clerk session cookie header value. Without
//                 it the authenticated (database-fault) phase cannot run: the
//                 auth gate answers 401 before a handler ever touches the DB.
//   DB_FAULT      set to "1" by the operator when the server under test was
//                 started with a deliberately broken DATABASE_URL.
//
// Preflight — GET /api/health (the one public route). If the server is not up,
// or the Clerk auth gate cannot even evaluate a request (no Clerk keys in the
// environment), nothing downstream is testable and the run reports
// blocked_external with exit code 78. It never reports a pass it did not earn.
//
// Phase 1 (needs a bootable server) — the auth gate. Every route/method is
// probed unauthenticated and must answer non-2xx with a body that is EXACTLY
// { error: { code, correlationId } }, a non-empty correlation id, and no
// internal text of any kind.
//
// Phase 2 (needs PROBE_COOKIE + DB_FAULT) — the database fault. The same routes
// are probed WITH a session against a server whose DATABASE_URL points nowhere,
// so each handler's driver call really throws. Same assertions, plus: the write
// routes must not answer 2xx.
//
// Writes goals/evidence/N00d-error-envelope/fault-injection.json.
// Exit codes: 0 = every runnable assertion passed, 1 = a runnable assertion
// failed, 78 = blocked_external (a named verification needs operator input).

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const BASE_URL = process.env.BASE_URL || "http://localhost:3111";
const PROBE_COOKIE = process.env.PROBE_COOKIE || "";
const DB_FAULT = process.env.DB_FAULT === "1";
const OUT = join(ROOT, "goals", "evidence", "N00d-error-envelope", "fault-injection.json");
const EX_BLOCKED = 78;

const SERVER_CMD =
  "node --env-file=.env.local ./node_modules/.bin/next dev -p 3111 " +
  "> goals/evidence/N00d-error-envelope/server-output.txt 2>&1 &";

const CLERK_CMD =
  "add NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY to .env.local (the dev Clerk instance), then: " +
  SERVER_CMD;

const DB_FAULT_CMD =
  'DATABASE_URL="postgresql://neondb_owner:invalid@127.0.0.1:1/neondb?sslmode=require" ' +
  "node --env-file=.env.local ./node_modules/.bin/next dev -p 3111 " +
  "> goals/evidence/N00d-error-envelope/server-output.txt 2>&1 & " +
  'BASE_URL=http://localhost:3111 DB_FAULT=1 PROBE_COOKIE="__session=<clerk session jwt>" ' +
  "node scripts/verify/fault-injection.mjs --all-routes";

// Every route × method the app exposes, with a body where one is required.
const PROBES = [
  { route: "/api/store", method: "GET", path: "/api/store?key=nrv_settings" },
  { route: "/api/store", method: "POST", path: "/api/store", body: { key: "nrv_settings", value: { probe: true } }, write: true },
  { route: "/api/store", method: "DELETE", path: "/api/store?key=nrv_settings", write: true },
  { route: "/api/exams", method: "GET", path: "/api/exams" },
  { route: "/api/exams", method: "GET", path: "/api/exams?batches=1" },
  { route: "/api/exams", method: "POST", path: "/api/exams", body: { batchId: "probe", exams: [{ cpt: "70450", wrvu: 0 }] }, write: true },
  { route: "/api/exams", method: "DELETE", path: "/api/exams?batchId=probe", write: true },
  { route: "/api/extra-duty", method: "GET", path: "/api/extra-duty" },
  { route: "/api/extra-duty", method: "POST", path: "/api/extra-duty", body: { payModel: "per_diem", bundleDate: "2026-01-01T00:00:00", amount: 0 }, write: true },
  { route: "/api/extra-duty", method: "DELETE", path: "/api/extra-duty?id=00000000-0000-0000-0000-000000000000", write: true },
  { route: "/api/extra-duty/rates", method: "GET", path: "/api/extra-duty/rates" },
  { route: "/api/extra-duty/rates", method: "POST", path: "/api/extra-duty/rates", body: { perDiemRate: 0, ppcMri: 0, ppcCt: 0, ppcXr: 0 }, write: true },
  { route: "/api/rvu-tables", method: "GET", path: "/api/rvu-tables" },
  { route: "/api/rvu-tables", method: "POST", path: "/api/rvu-tables", body: { name: "probe", codes: [] }, write: true },
  // N00c: the wire is { template, params, attachments }. A `messages` body is
  // now a 400 before the route does any work, which would make this probe test
  // the request gate instead of the failure envelope.
  {
    route: "/api/claude",
    method: "POST",
    path: "/api/claude",
    body: {
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
    },
  },
  { route: "/api/internal/usage", method: "GET", path: "/api/internal/usage" },
  {
    route: "/api/internal/usage",
    method: "POST",
    path: "/api/internal/usage",
    body: { source: "edge-api:resolve", inputTokens: 1, outputTokens: 1 },
    write: true,
  },
];

// Anything in this list appearing in a response body is a leak.
const LEAK_PATTERNS = [
  /postgres/i, /neon/i, /\bpg[_-]/i, /drizzle/i, /\bsql\b/i, /syntax error/i,
  /relation ".*" does not exist/i, /duplicate key/i, /constraint/i, /column/i,
  /ECONNREFUSED/i, /ENOTFOUND/i, /getaddrinfo/i, /certificate/i,
  /anthropic/i, /api\.anthropic\.com/i, /x-api-key/i, /clerk/i,
  /\bat .+:\d+:\d+/, /Error:/, /stack/i, /node_modules/,
  /DATABASE_URL/, /POSTGRES_URL/, /ANTHROPIC_API_KEY/,
];

const results = [];
const blockedExternal = [];
let failures = 0;

function record(entry) {
  results.push(entry);
  const tag = entry.outcome === "pass" ? "PASS" : entry.outcome === "blocked_external" ? "BLOCKED" : "FAIL";
  if (entry.outcome === "fail") failures += 1;
  console.log(`${tag}  ${entry.phase}  ${entry.method} ${entry.path}  -> ${entry.status ?? "-"}  ${entry.notes.join("; ")}`);
}

async function probe(p, headers) {
  const url = `${BASE_URL}${p.path}`;
  const init = { method: p.method, headers: { ...headers }, redirect: "manual" };
  if (p.body) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(p.body);
  }
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    return { transport: `unreachable: ${err?.message || err}` };
  }
  const text = await res.text();
  let body = null;
  let parsed = true;
  try {
    body = JSON.parse(text);
  } catch {
    parsed = false;
  }
  return { res, text, body, parsed, correlationId: res.headers.get("x-correlation-id") || "" };
}

function assertEnvelope(out, notes) {
  const { res, text, body, parsed } = out;
  let ok = true;
  const bad = (m) => {
    notes.push(m);
    ok = false;
  };

  if (res.status < 400) bad(`expected non-2xx, got ${res.status}`);
  if (!parsed) bad("body is not JSON");
  if (parsed) {
    const keys = Object.keys(body || {});
    if (keys.length !== 1 || keys[0] !== "error") bad(`body keys are ${JSON.stringify(keys)}, expected ["error"]`);
    const inner = Object.keys(body?.error || {}).sort();
    if (inner.join(",") !== "code,correlationId") bad(`error keys are ${JSON.stringify(inner)}`);
    if (!body?.error?.correlationId) bad("correlation id missing from body");
  }
  const headerId = res.headers.get("x-correlation-id");
  if (!headerId) bad("x-correlation-id response header missing");
  if (parsed && headerId && body?.error?.correlationId !== headerId) bad("header and body correlation ids differ");
  for (const re of LEAK_PATTERNS) {
    if (re.test(text)) bad(`body leaks internals (${re})`);
  }
  if (ok) notes.push(`code=${body.error.code} cid=${body.error.correlationId}`);
  return ok;
}

async function runPhase(phase, headers) {
  for (const p of PROBES) {
    const notes = [];
    const out = await probe(p, headers);
    if (out.transport) {
      record({ phase, route: p.route, method: p.method, path: p.path, status: null, outcome: "fail", notes: [out.transport], correlationId: null });
      continue;
    }
    let ok = assertEnvelope(out, notes);
    if (phase === "db-fault" && p.write && out.res.status < 400) {
      notes.push("a failed write answered 2xx");
      ok = false;
    }
    record({
      phase,
      route: p.route,
      method: p.method,
      path: p.path,
      status: out.res.status,
      outcome: ok ? "pass" : "fail",
      notes,
      correlationId: out.body?.error?.correlationId || out.correlationId || null,
    });
  }
}

function finish(exitCode, phases, preflight) {
  const summary = {
    node: "N00d-error-envelope",
    startedAt,
    finishedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    dbFaultInjected: DB_FAULT,
    preflight,
    phases,
    blockedExternal,
    counts: {
      total: results.length,
      pass: results.filter((r) => r.outcome === "pass").length,
      fail: results.filter((r) => r.outcome === "fail").length,
      blocked_external: results.filter((r) => r.outcome === "blocked_external").length,
    },
    correlationIds: results.filter((r) => r.correlationId).map((r) => r.correlationId),
    results,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`\n${JSON.stringify(summary.counts)}`);
  for (const b of blockedExternal) {
    console.log(`\nBLOCKED_EXTERNAL: ${b.what}\n  why: ${b.why}\n  command: ${b.command}`);
  }
  console.log(`\nevidence -> ${OUT}`);
  process.exit(exitCode);
}

const startedAt = new Date().toISOString();
console.log(`fault-injection against ${BASE_URL} (db_fault=${DB_FAULT ? "yes" : "no"})`);

// ------------------------------------------------------------------ preflight
let preflight;
try {
  const res = await fetch(`${BASE_URL}/api/health`, { redirect: "manual" });
  const text = await res.text();
  preflight = { reachable: true, status: res.status, sample: text.slice(0, 300) };
  console.log(`preflight GET /api/health -> ${res.status}`);
  if (res.status !== 200) {
    blockedExternal.push({
      what: "every HTTP probe (auth-gate and db-fault phases)",
      why:
        `the server answers ${res.status} on the public health route, so no request reaches a route handler. ` +
        "The Clerk middleware cannot evaluate a request without NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY / CLERK_SECRET_KEY, " +
        "and those credentials are not available to this environment.",
      command: CLERK_CMD,
    });
    finish(EX_BLOCKED, { "auth-gate": "blocked_external", "db-fault": "blocked_external" }, preflight);
  }
} catch (err) {
  preflight = { reachable: false, status: null, sample: String(err?.message || err) };
  blockedExternal.push({
    what: "every HTTP probe (auth-gate and db-fault phases)",
    why: `no server is listening on ${BASE_URL}`,
    command: SERVER_CMD,
  });
  finish(EX_BLOCKED, { "auth-gate": "blocked_external", "db-fault": "blocked_external" }, preflight);
}

// ---------------------------------------------------------------- phase 1
await runPhase("auth-gate", {});

// ---------------------------------------------------------------- phase 2
let dbPhase = "ran";
if (!PROBE_COOKIE || !DB_FAULT) {
  dbPhase = "blocked_external";
  blockedExternal.push({
    what: "authenticated fault injection (forced database failure per route)",
    why: !PROBE_COOKIE
      ? "requires a real signed-in Clerk session; the auth gate answers 401 before any handler touches the database"
      : "PROBE_COOKIE is set but DB_FAULT=1 was not — refusing to probe a healthy database",
    command: DB_FAULT_CMD,
  });
  for (const p of PROBES) {
    record({
      phase: "db-fault",
      route: p.route,
      method: p.method,
      path: p.path,
      status: null,
      outcome: "blocked_external",
      notes: ["needs a real Clerk session cookie in PROBE_COOKIE and a server started with a broken DATABASE_URL"],
      correlationId: null,
    });
  }
} else {
  await runPhase("db-fault", { Cookie: PROBE_COOKIE });
}

finish(failures > 0 ? 1 : dbPhase === "blocked_external" ? EX_BLOCKED : 0, { "auth-gate": "ran", "db-fault": dbPhase }, preflight);
