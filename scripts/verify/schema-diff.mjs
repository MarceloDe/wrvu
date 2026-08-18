#!/usr/bin/env node
// Diff two schemas. Sources: --left-env VAR (live) or --left-sql f1,f2 (applied to
// an ephemeral Postgres). Same for --right-. Exits 1 on ANY difference.
import { pass, fail } from "./_lib.mjs";
import { haveDocker, startEphemeral, stopEphemeral, applySql, snapshot, diff } from "./_pg.mjs";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const out = arg("--out");

async function resolve(side) {
  const env = arg(`--${side}-env`), sqls = arg(`--${side}-sql`);
  if (env) {
    if (!process.env[env]) fail(`$${env} is not set (--${side}-env). Run with --env-file=.env.local`);
    return { snap: await snapshot(process.env[env]), label: env };
  }
  if (sqls) {
    if (!haveDocker()) fail("docker is not running — applying SQL needs an ephemeral Postgres");
    const pg = startEphemeral(`diff${side}${process.pid}`);
    try {
      for (const f of sqls.split(",")) applySql(pg.url, join(process.cwd(), f.trim()));
      return { snap: await snapshot(pg.url), label: sqls };
    } finally { stopEphemeral(pg.name); }
  }
  fail(`give --${side}-env VAR or --${side}-sql file[,file]`);
}

const L = await resolve("left"), R = await resolve("right");
const differences = diff(L.snap, R.snap, L.label, R.label);
if (out) writeFileSync(out, JSON.stringify({ left: L.label, right: R.label, differences }, null, 2));
differences.length
  ? fail(`${differences.length} difference(s) between ${L.label} and ${R.label}`, differences.slice(0, 20))
  : pass(`${L.label} and ${R.label} are identical${out ? ` -> ${out}` : ""}`);
