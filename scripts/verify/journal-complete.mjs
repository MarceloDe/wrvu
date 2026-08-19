#!/usr/bin/env node
// Every migration on disk must be in the journal, and vice versa.
//
// lib/db/migrate.mjs is journal-driven on purpose — a migrator that globbed the
// directory would apply whatever happened to be lying there. The cost of that choice
// is an orphan: a .sql file that is committed, reviewed, and never runs.
//
// This is not hypothetical. drizzle/0002_rls.sql shipped in PR #9 without a journal
// entry. Every check still passed, because cross-tenant-probe.mjs applies the file
// directly with psql — so the POLICIES were proven correct while the MIGRATOR would
// never have applied them to any real database. Nothing in the suite noticed.
import { pass, fail } from "./_lib.mjs";
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./_lib.mjs";

const DIR = join(ROOT, "drizzle");
const JOURNAL = join(DIR, "meta/_journal.json");

// Operator-run one-offs that deliberately live outside the forward sequence. Each
// entry must name why, and must still exist — a stale exclusion hides a real orphan.
const OUT_OF_BAND = {
  "0000_backfill_migrations": "one-off: stamps production's pre-existing schema into _migrations, run once by the operator in the Neon console",
};

if (!existsSync(DIR)) fail("drizzle/ does not exist — there is no migration set to audit");
if (!existsSync(JOURNAL)) fail("drizzle/meta/_journal.json does not exist — the migrator has no plan to follow");

const onDisk = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql") && !f.endsWith(".down.sql"))
  .map((f) => f.replace(/\.sql$/, ""));
if (onDisk.length === 0) fail("zero forward migrations found — the parser is broken or drizzle/ is empty");

const entries = JSON.parse(readFileSync(JOURNAL, "utf8")).entries ?? [];
if (entries.length === 0) fail("the journal lists zero migrations — the migrator would apply nothing and exit 0");
const tags = entries.map((e) => e.tag);

const problems = [];

for (const f of onDisk) {
  if (tags.includes(f)) continue;
  if (f in OUT_OF_BAND) continue;
  problems.push(`ORPHAN  drizzle/${f}.sql is committed but absent from the journal — the migrator will never apply it`);
}
for (const t of tags) {
  if (!existsSync(join(DIR, `${t}.sql`))) problems.push(`MISSING  the journal lists "${t}" but drizzle/${t}.sql does not exist — the migrator will throw`);
}
for (const [t, why] of Object.entries(OUT_OF_BAND)) {
  if (!existsSync(join(DIR, `${t}.sql`))) problems.push(`STALE EXCLUSION  "${t}" is excused (${why}) but no longer exists — remove it, or a real orphan can hide behind it`);
  if (tags.includes(t)) problems.push(`CONTRADICTION  "${t}" is excused as out-of-band yet also listed in the journal`);
}
// Ordering: idx must be dense and ascending, or `plan()` applies them out of order.
entries.forEach((e, i) => { if (e.idx !== i) problems.push(`ORDER  entry ${i} ("${e.tag}") has idx ${e.idx} — indices must be dense and ascending`); });

// A forward migration with no rollback is not automatically wrong, but it must be a
// choice. Report it so the omission is visible in review rather than discovered later.
const noDown = tags.filter((t) => !existsSync(join(DIR, `${t}.down.sql`)) && t !== "0000_baseline");
problems.length
  ? fail(`${problems.length} problem(s) between drizzle/ and the journal`, problems)
  : pass(`journal and disk agree on all ${tags.length} migration(s)${noDown.length ? `; no rollback for: ${noDown.join(", ")}` : "; every migration has a rollback"}`);
