#!/usr/bin/env node
// N02 — corrupting an ALREADY-APPLIED migration must make the migrator refuse.
import { pass, fail, pending, has } from "./_lib.mjs";
import { readFileSync, writeFileSync, copyFileSync, unlinkSync } from "node:fs";
import { execSync } from "node:child_process";
const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const out = arg("--out") || "/dev/stdout";

if (!has("lib/db/migrate.mjs")) pending("lib/db/migrate.mjs does not exist yet", "N02 lands the migrator");
const target = "drizzle/0001_llm_usage.sql";
if (!has(target)) pending(`${target} does not exist`, "N02 lands the migration set");

const backup = `${target}.checksum-guard.bak`;
copyFileSync(target, backup);
let log = "";
try {
  writeFileSync(target, readFileSync(target, "utf8") + "\n-- checksum-guard tamper\n");
  try {
    execSync(`node lib/db/migrate.mjs --url "${process.env.DATABASE_URL_UNPOOLED}"`, { encoding: "utf8", stdio: "pipe" });
    log = "migrator EXITED ZERO on a tampered applied migration";
    writeFileSync(out, log + "\n");
    fail(log);
  } catch (e) {
    const msg = `${e.stdout || ""}${e.stderr || ""}`;
    log = `REFUSED\nexit=${e.status}\n${msg}`;
    writeFileSync(out, log + "\n");
    if (!msg.includes(target.split("/").pop())) fail("migrator refused but did not name the tampered file", [msg.slice(0, 300)]);
  }
} finally { copyFileSync(backup, target); unlinkSync(backup); }
pass(`migrator REFUSED a tampered applied migration and named it -> ${out}`);
