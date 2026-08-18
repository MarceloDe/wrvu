#!/usr/bin/env node
// Proves that an error raised through the real error envelope leaves the
// process and lands in a monitoring destination — over real HTTP, against the
// real logger module. Nothing is stubbed: ERROR_MONITOR_URL points at whatever
// collector is listening (scripts/verify/monitor-sink.mjs locally, the
// operator's Sentry/Logtail/Datadog ingest URL in production).
//
//   node scripts/verify/monitor-sink.mjs &
//   ERROR_MONITOR_URL=http://127.0.0.1:4319/ingest node scripts/verify/monitor-roundtrip.mjs
//
// Writes goals/evidence/N00d-error-envelope/monitor-roundtrip.txt.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

import { failLogged, newCorrelationId } from "../../lib/http/errors.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const EVIDENCE = join(ROOT, "goals", "evidence", "N00d-error-envelope");
const MONITOR_LOG = process.env.MONITOR_LOG || join(EVIDENCE, "monitor-capture.jsonl");
const OUT = join(EVIDENCE, "monitor-roundtrip.txt");

const lines = [];
const say = (s) => {
  lines.push(s);
  console.log(s);
};

const url = process.env.ERROR_MONITOR_URL;
say(`monitor-roundtrip: ERROR_MONITOR_URL=${url || "(unset)"}`);
if (!url) {
  console.error("ERROR_MONITOR_URL is not set — nothing to verify");
  process.exit(78);
}

// A real failure, built by the real envelope, carrying a real driver error.
const correlationId = newCorrelationId();
const cause = new Error("connect ECONNREFUSED 127.0.0.1:1 (synthetic driver failure)");
cause.name = "NeonDbError";
const res = failLogged("storage_unavailable", 503, {
  route: "verify monitor-roundtrip",
  correlationId,
  cause,
  message: "synthetic storage failure for monitoring verification",
});

const body = await res.json();
say(`envelope status: ${res.status}`);
say(`envelope body:   ${JSON.stringify(body)}`);
say(`correlation id:  ${correlationId}`);

if (JSON.stringify(body) !== JSON.stringify({ error: { code: "storage_unavailable", correlationId } })) {
  console.error("envelope body is not exactly { error: { code, correlationId } }");
  process.exit(1);
}
if (JSON.stringify(body).includes("ECONNREFUSED") || JSON.stringify(body).includes("Neon")) {
  console.error("driver text leaked into the response body");
  process.exit(1);
}

// Give the fire-and-forget ship a moment to land.
let captured = "";
for (let i = 0; i < 25; i += 1) {
  await sleep(200);
  captured = existsSync(MONITOR_LOG) ? readFileSync(MONITOR_LOG, "utf8") : "";
  if (captured.includes(correlationId)) break;
}

const landed = captured.includes(correlationId);
const carriesCause = captured.includes("ECONNREFUSED");
say(`monitor capture: ${MONITOR_LOG} (${captured.length} bytes)`);
say(`correlation id present in monitoring destination: ${landed ? "yes" : "NO"}`);
say(`driver detail present in monitoring destination:  ${carriesCause ? "yes" : "no"}`);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${lines.join("\n")}\n`);
console.log(`\nevidence -> ${OUT}`);

if (!landed) {
  console.error("the error never reached the monitoring destination");
  process.exit(1);
}
