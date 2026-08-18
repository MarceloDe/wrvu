#!/usr/bin/env node
// Apply the migration set to an EMPTY database and diff the result against a
// reference. Answers "do these files produce that schema" — a property of the SQL.
//
// Runs on an ephemeral local Postgres, NOT a Neon branch: branch creation is
// unavailable here (no neonctl, no API key — goals/DECISIONS.md). Real Postgres 17
// in Docker is not a mock.
import { pass, fail, pending, has, ROOT } from "./_lib.mjs";
import { haveDocker, startEphemeral, stopEphemeral, applySql, snapshot, diff } from "./_pg.mjs";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const out = arg("--out");
const refEnv = arg("--reference-env") || "DATABASE_URL";
const ref = process.env[refEnv];

const JOURNAL = "drizzle/meta/_journal.json";
if (!has(JOURNAL)) pending(`${JOURNAL} does not exist, so there is no ordered migration set to replay`, "N02 lands the journal");
if (!ref) fail(`$${refEnv} is not set — replay needs a reference schema to diff against. Run with --env-file=.env.local`);
if (!haveDocker()) fail("docker is not running — replay needs an empty Postgres. Start Docker Desktop.");

const journal = JSON.parse(readFileSync(join(ROOT, JOURNAL), "utf8"));
const tags = journal.entries.map((e) => e.tag);
if (!tags.length) fail("the journal lists zero migrations");

const pg = startEphemeral();
let result;
try {
  for (const tag of tags) {
    const f = join(ROOT, "drizzle", `${tag}.sql`);
    if (!existsSync(f)) fail(`journal lists ${tag} but drizzle/${tag}.sql does not exist`);
    applySql(pg.url, f);
  }
  const replayed = await snapshot(pg.url);
  const reference = await snapshot(ref);
  const differences = diff(replayed, reference, "replayed", "reference");
  result = { applied: tags.length, tags, differences, referenceEnv: refEnv };
} finally { stopEphemeral(pg.name); }

if (out) writeFileSync(out, JSON.stringify(result, null, 2));
result.differences.length
  ? fail(`replaying ${result.applied} migration(s) does NOT reproduce the reference schema`, result.differences.slice(0, 20))
  : pass(`replaying ${result.applied} migration(s) reproduces the reference schema exactly${out ? ` -> ${out}` : ""}`);
