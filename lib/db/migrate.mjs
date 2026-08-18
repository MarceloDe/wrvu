#!/usr/bin/env node
// The single schema path. Applies pending migrations in journal order, each inside
// a transaction, and records what it applied.
//
// Connection is taken by ENV VAR NAME (--url-env), never as an inline --url: a
// connection string in argv leaks into process listings and into any error text
// that echoes the command. That is not hypothetical — a pg_dump version mismatch
// printed this project's dev URL, password and all, earlier today.
//
// Use the UNPOOLED URL. DATABASE_URL is Neon's pgBouncer pooler, and pgBouncer in
// transaction mode breaks session-level DDL.
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// node-postgres, not the Neon serverless driver. Neon's WebSocket transport only
// speaks to Neon (it dials wss://<host>/v2), which makes the migrator untestable
// against a local Postgres — and replay-on-empty is exactly how these migrations get
// proven. Neon accepts the standard protocol on its unpooled endpoint, so one driver
// covers production AND the ephemeral container.
import pg from "pg";
const { Pool } = pg;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = join(ROOT, "drizzle");
const JOURNAL = join(DIR, "meta/_journal.json");

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const checkOnly = process.argv.includes("--check");
const stamp = process.argv.includes("--stamp");

export function plan() {
  if (!existsSync(JOURNAL)) throw new Error(`no journal at ${JOURNAL}`);
  return JSON.parse(readFileSync(JOURNAL, "utf8")).entries.map((e) => {
    const file = join(DIR, `${e.tag}.sql`);
    if (!existsSync(file)) throw new Error(`journal lists ${e.tag} but ${file} does not exist`);
    const sql = readFileSync(file, "utf8");
    return { tag: e.tag, file, sql, checksum: createHash("sha256").update(sql).digest("hex") };
  });
}

// `stamp` records migrations as applied WITHOUT executing them. Needed exactly twice:
// on the dev branch, whose schema predates this migrator, and on production, where
// 0001 was applied by hand on 2026-08-18. It is the standard baseline operation and it
// is deliberately explicit — a migrator that silently skipped existing objects would
// hide a real schema divergence.
export async function run(url, { check = false, stamp = false, log = console.log } = {}) {
  const migrations = plan();
  // Do NOT pass ssl:{rejectUnauthorized:false} — that silently disables certificate
  // verification against production. Let the connection string's sslmode govern: Neon
  // URLs carry sslmode=require, which node-postgres treats as verify-full. Local
  // ephemeral URLs carry no sslmode and connect in the clear, which is correct for a
  // container on localhost.
  const pool = new Pool({ connectionString: url });
  const c = await pool.connect();
  try {
    await c.query(`create table if not exists _migrations (
      name text primary key,
      checksum text not null,
      applied_at timestamptz not null default now())`);

    const { rows } = await c.query("select name, checksum from _migrations");
    const applied = new Map(rows.map((r) => [r.name, r.checksum]));

    // Drift first. An applied migration whose file changed means the recorded history
    // no longer describes the database, and every later decision rests on a lie.
    const drifted = migrations.filter((m) => applied.has(m.tag) && applied.get(m.tag) !== m.checksum);
    if (drifted.length) {
      const names = drifted.map((d) => `drizzle/${d.tag}.sql`);
      throw new Error(
        `REFUSING to migrate: ${drifted.length} already-applied migration(s) no longer match the recorded checksum:\n` +
        names.map((n) => `  ${n}`).join("\n") +
        `\nAn applied migration is history. Add a new migration instead of editing one.`
      );
    }

    const pending = migrations.filter((m) => !applied.has(m.tag));
    if (!pending.length) { log(`nothing to apply — ${applied.size} migration(s) already recorded`); return { applied: 0, pending: 0 }; }
    if (check) { log(`${pending.length} pending: ${pending.map((p) => p.tag).join(", ")}`); return { applied: 0, pending: pending.length }; }

    if (stamp) {
      for (const m of pending) {
        await c.query("insert into _migrations (name, checksum) values ($1, $2)", [m.tag, m.checksum]);
        log(`stamped ${m.tag} (recorded as applied; SQL NOT executed)`);
      }
      return { applied: 0, stamped: pending.length, pending: 0 };
    }

    for (const m of pending) {
      await c.query("begin");
      try {
        await c.query(m.sql);
        await c.query("insert into _migrations (name, checksum) values ($1, $2)", [m.tag, m.checksum]);
        await c.query("commit");
        log(`applied ${m.tag}`);
      } catch (e) {
        await c.query("rollback");
        throw new Error(`${m.tag} failed and was rolled back: ${e.message}`);
      }
    }
    return { applied: pending.length, pending: 0 };
  } finally { c.release(); await pool.end(); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const envName = arg("--url-env");
  if (!envName) { console.error("usage: migrate.mjs --url-env DATABASE_URL_UNPOOLED [--check] [--stamp]"); process.exit(2); }
  const url = process.env[envName];
  if (!url) { console.error(`$${envName} is not set. Run with --env-file=.env.local`); process.exit(2); }
  try {
    const r = await run(url, { check: checkOnly, stamp });
    if (checkOnly && r.pending) process.exit(1);
  } catch (e) { console.error(e.message); process.exit(1); }
}
