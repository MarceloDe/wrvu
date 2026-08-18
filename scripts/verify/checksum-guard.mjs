#!/usr/bin/env node
// Corrupting an ALREADY-APPLIED migration must make the migrator REFUSE.
//
// The refusal must be distinguishable from a crash: an earlier draft wrote the
// token "REFUSED" on ANY non-zero exit, so a bad connection string satisfied the
// grep. Here the message must name the tampered file before anything is written.
import { pass, fail, pending, has, ROOT } from "./_lib.mjs";
import { readFileSync, writeFileSync, copyFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, basename } from "node:path";

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const out = arg("--out");
const urlEnv = arg("--url-env") || "DATABASE_URL_UNPOOLED";

if (!has("lib/db/migrate.mjs")) pending("lib/db/migrate.mjs does not exist yet", "N02 lands the migrator");
const target = "drizzle/0001_llm_usage.sql";
if (!has(target)) pending(`${target} does not exist`, "N02 lands the migration set");
if (!process.env[urlEnv]) fail(`$${urlEnv} is not set. Run with --env-file=.env.local`);

const abs = join(ROOT, target), backup = `${abs}.guard.bak`;
copyFileSync(abs, backup);
let verdict;
try {
  writeFileSync(abs, readFileSync(abs, "utf8") + "\n-- checksum-guard tamper\n");
  const r = spawnSync("node", [join(ROOT, "lib/db/migrate.mjs"), "--url-env", urlEnv], { encoding: "utf8", env: process.env });
  const msg = `${r.stdout || ""}${r.stderr || ""}`;
  if (r.status === 0) verdict = { refused: false, why: "migrator exited ZERO on a tampered applied migration", msg };
  else if (!msg.includes(basename(target))) verdict = { refused: false, why: "non-zero exit, but the message does not name the tampered file — indistinguishable from a crash", exit: r.status, msg: msg.slice(0, 400) };
  else verdict = { refused: true, exit: r.status, msg: msg.slice(0, 400) };
} finally { copyFileSync(backup, abs); unlinkSync(backup); }

if (out) writeFileSync(out, (verdict.refused ? "REFUSED\n" : "NOT REFUSED\n") + JSON.stringify(verdict, null, 2));
verdict.refused
  ? pass(`migrator REFUSED a tampered applied migration and named it${out ? ` -> ${out}` : ""}`)
  : fail(verdict.why, [verdict.msg?.slice(0, 300) ?? ""]);
