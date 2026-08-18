#!/usr/bin/env node
// A real HTTP monitoring destination, for verifying that errors actually leave
// the process. Point ERROR_MONITOR_URL at it and every structured error line
// the app emits is POSTed here and appended to a capture file.
//
//   node scripts/verify/monitor-sink.mjs
//   ERROR_MONITOR_URL=http://127.0.0.1:4319/ingest  (default)
//
// This stands in for the production destination (Sentry / Logtail / Datadog),
// which needs an operator-provisioned DSN. It is a real server over real HTTP,
// not a mock of one: the app does not know or care what is on the other end.

import { createServer } from "node:http";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.env.MONITOR_LOG || join(ROOT, "goals", "evidence", "N00d-error-envelope", "monitor-capture.jsonl");
const PORT = Number(process.env.MONITOR_PORT || 4319);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, "");

let received = 0;

createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");
    if (body.trim()) {
      appendFileSync(OUT, `${body.trim()}\n`);
      received += 1;
      console.log(`[monitor-sink] #${received} ${body.slice(0, 200)}`);
    }
    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ accepted: true }));
  });
}).listen(PORT, "127.0.0.1", () => {
  console.log(`[monitor-sink] listening on http://127.0.0.1:${PORT} -> ${OUT}`);
});
