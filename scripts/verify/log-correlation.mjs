#!/usr/bin/env node
// Every correlation id a caller was given must be findable in the server's own
// log stream — that is the whole point of the id. This reads the ids recorded
// by fault-injection.mjs and greps the captured server output for each one.
//
//   node scripts/verify/log-correlation.mjs
//
// Environment:
//   SERVER_LOG   captured stdout+stderr of the server under test
//                (default goals/evidence/N00d-error-envelope/server.log)
//   MONITOR_LOG  capture file of the monitoring destination, checked the same
//                way so "errors reach a monitoring destination" is evidenced
//                rather than asserted.
//
// Writes goals/evidence/N00d-error-envelope/log-correlation.txt.
// Exit codes: 0 = every id was found, 1 = an id was missing, 78 = the upstream
// fault-injection run was itself blocked_external, so there is nothing to check.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const EVIDENCE = join(ROOT, "goals", "evidence", "N00d-error-envelope");
const INJECTION = join(EVIDENCE, "fault-injection.json");
const SERVER_LOG = process.env.SERVER_LOG || join(EVIDENCE, "server-output.txt");
const MONITOR_LOG = process.env.MONITOR_LOG || join(EVIDENCE, "monitor-capture.jsonl");
const OUT = join(EVIDENCE, "log-correlation.txt");
const EX_BLOCKED = 78;

const lines = [];
const say = (s) => {
  lines.push(s);
  console.log(s);
};

function write(exitCode) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${lines.join("\n")}\n`);
  console.log(`\nevidence -> ${OUT}`);
  process.exit(exitCode);
}

if (!existsSync(INJECTION)) {
  console.error(`missing ${INJECTION} — run scripts/verify/fault-injection.mjs first`);
  process.exit(1);
}

const injection = JSON.parse(readFileSync(INJECTION, "utf8"));
const log = existsSync(SERVER_LOG) ? readFileSync(SERVER_LOG, "utf8") : null;
const monitor = existsSync(MONITOR_LOG) ? readFileSync(MONITOR_LOG, "utf8") : null;

say(`log-correlation for ${injection.node}`);
say(`fault-injection phases: ${JSON.stringify(injection.phases)}`);
say(`server log:   ${log === null ? `absent (${SERVER_LOG})` : `${SERVER_LOG} (${log.length} bytes)`}`);
say(`monitor log:  ${monitor === null ? `absent (${MONITOR_LOG})` : `${MONITOR_LOG} (${monitor.length} bytes)`}`);
say("");

const ids = injection.results.filter((r) => r.correlationId);

if (ids.length === 0) {
  say("No correlation ids were produced: the fault-injection run reached no route handler.");
  for (const b of injection.blockedExternal || []) {
    say("");
    say(`BLOCKED_EXTERNAL: ${b.what}`);
    say(`  why: ${b.why}`);
    say(`  command: ${b.command}`);
  }
  write(EX_BLOCKED);
}

if (log === null) {
  console.error(`missing server log ${SERVER_LOG} — start the server with its output tee'd there`);
  process.exit(1);
}

const failures = [];
let inMonitor = 0;

for (const r of ids) {
  const inLog = log.includes(r.correlationId);
  const shipped = monitor !== null && monitor.includes(r.correlationId);
  if (shipped) inMonitor += 1;
  if (!inLog) failures.push(r);
  say(
    `${inLog ? "FOUND  " : "MISSING"}  ${r.method} ${r.path}  status=${r.status}  cid=${r.correlationId}` +
      (monitor === null ? "" : `  monitor=${shipped ? "yes" : "no"}`),
  );
}

say("");
say(`checked ${ids.length} correlation id(s); ${ids.length - failures.length} present in the server log`);
if (monitor !== null) say(`${inMonitor}/${ids.length} also present in the monitoring destination capture`);

for (const b of injection.blockedExternal || []) {
  say("");
  say(`BLOCKED_EXTERNAL: ${b.what}`);
  say(`  why: ${b.why}`);
  say(`  command: ${b.command}`);
}

if (failures.length) {
  console.error(`${failures.length} correlation id(s) never reached the log stream`);
  write(1);
}
write((injection.blockedExternal || []).length ? EX_BLOCKED : 0);
