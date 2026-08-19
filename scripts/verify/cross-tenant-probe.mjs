#!/usr/bin/env node
// INV-TENANT (N04c) — try to read another tenant's rows, and fail if you can.
//
// Runs against an EPHEMERAL LOCAL POSTGRES 17, not a mock and not Neon. The question
// this answers — "do these policies stop a non-owner role from crossing tenants" — is
// a property of the SQL and the role attributes, both of which a real Postgres has.
// It is also the only place the full sequence can be rehearsed: creating roles and
// rotating a connection string on the production project is an operator action.
//
// The probe proves FIVE things, because RLS fails in five different directions:
//   READ    a scoped connection sees only its own rows
//   WRITE   it cannot INSERT a row owned by someone else (WITH CHECK)
//   UPDATE  it cannot mutate another tenant's row (0 rows affected, not an error)
//   DELETE  it cannot remove another tenant's row
//   UNSET   with no tenant set it sees NOTHING — fail closed, never fail open
//
// It then runs rls-enabled.mjs twice: as the restricted role (must PASS) and as the
// superuser owner (must FAIL). A checker that has never been observed to pass on a
// correct configuration is not known to be a checker at all.
import { pass, fail, pending, ROOT } from "./_lib.mjs";
import { haveDocker, startEphemeral, stopEphemeral, applySql } from "./_pg.mjs";
import { spawnSync } from "node:child_process";
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const out = arg("--out");

const MIGRATIONS = ["drizzle/0000_baseline.sql", "drizzle/0001_llm_usage.sql", "drizzle/0002_rls.sql"];
for (const m of MIGRATIONS) {
  if (!existsSync(join(ROOT, m))) pending(`${m} does not exist`, "N04 lands the RLS migration");
}
if (!haveDocker()) pending("Docker is not running, so no ephemeral Postgres can be started", "Docker is available (it is required for every replay check)");

const A = "user_tenant_a", B = "user_tenant_b";
const results = [];
const problems = [];
const ok = (name, cond, detail) => { results.push({ name, ok: !!cond, detail }); if (!cond) problems.push(`${name}: ${detail}`); };

const pgc = startEphemeral(`rlsprobe${process.pid}`);
try {
  for (const m of MIGRATIONS) applySql(pgc.url, join(ROOT, m));

  const owner = new pg.Client({ connectionString: pgc.url });
  await owner.connect();
  // A LOGIN role that is a member of app_authenticated. Role ATTRIBUTES (BYPASSRLS,
  // SUPERUSER) are not inherited through membership, only privileges are — which is
  // exactly the separation RLS depends on.
  await owner.query(`create role app_login login password 'probe' in role app_authenticated`);
  await owner.query(
    `insert into exams (user_id, batch_id, cpt, wrvu) values ($1,'b1','70551',1.5), ($1,'b1','70553',2.29), ($2,'b2','70553',2.29)`,
    [A, B],
  );
  const seeded = await owner.query(`select user_id, count(*)::int n from exams group by 1 order by 1`);
  ok("fixture seeded for two tenants", seeded.rows.length === 2, JSON.stringify(seeded.rows));

  const appUrl = pgc.url.replace("postgres:x@", "app_login:probe@");
  const app = new pg.Client({ connectionString: appUrl });
  await app.connect();

  const attrs = await app.query(`select current_user u, rolbypassrls, rolsuper from pg_roles where rolname = current_user`);
  ok("app role has no BYPASSRLS", attrs.rows[0].rolbypassrls === false, JSON.stringify(attrs.rows[0]));
  ok("app role is not superuser", attrs.rows[0].rolsuper === false, JSON.stringify(attrs.rows[0]));

  // UNSET — no tenant configured must mean no rows, not all rows.
  const unset = await app.query(`select count(*)::int n from exams`);
  ok("UNSET tenant sees zero rows (fails closed)", unset.rows[0].n === 0, `saw ${unset.rows[0].n} rows with app.user_id unset`);

  // Scoped as tenant A.
  await app.query("begin");
  await app.query(`select set_config('app.user_id', $1, true)`, [A]);

  const mine = await app.query(`select count(*)::int n from exams`);
  ok("READ sees only own rows", mine.rows[0].n === 2, `expected 2, saw ${mine.rows[0].n}`);

  const theirs = await app.query(`select count(*)::int n from exams where user_id = $1`, [B]);
  ok("READ cannot reach another tenant even when naming them", theirs.rows[0].n === 0, `saw ${theirs.rows[0].n} of tenant B's rows`);

  let insertRejected = false, insertErr = "";
  try { await app.query(`insert into exams (user_id, batch_id, cpt, wrvu) values ($1,'b3','70553',2.29)`, [B]); }
  catch (e) { insertRejected = true; insertErr = e.message; }
  ok("WRITE cannot forge a row for another tenant", insertRejected, insertRejected ? insertErr : "the insert SUCCEEDED — WITH CHECK is missing or wrong");
  if (insertRejected) await app.query("rollback").then(() => app.query("begin")).then(() => app.query(`select set_config('app.user_id', $1, true)`, [A]));

  const upd = await app.query(`update exams set cpt = 'HACKED' where user_id = $1`, [B]);
  ok("UPDATE cannot mutate another tenant's row", upd.rowCount === 0, `${upd.rowCount} row(s) updated`);

  const del = await app.query(`delete from exams where user_id = $1`, [B]);
  ok("DELETE cannot remove another tenant's row", del.rowCount === 0, `${del.rowCount} row(s) deleted`);

  await app.query("commit");
  await app.end();

  const survived = await owner.query(`select count(*)::int n from exams where user_id = $1`, [B]);
  ok("tenant B's data survived the whole probe", survived.rows[0].n === 1, `${survived.rows[0].n} row(s) remain`);
  await owner.end();

  // The checker must PASS on this configuration and FAIL on the owner's.
  const runCheck = (url) => {
    const r = spawnSync("node", [join(ROOT, "scripts/verify/rls-enabled.mjs"), "--url-env", "PROBE_URL"],
      { encoding: "utf8", cwd: ROOT, env: { ...process.env, PROBE_URL: url } });
    return { status: r.status, out: `${r.stdout}${r.stderr}`.trim() };
  };
  const asApp = runCheck(appUrl);
  ok("rls-enabled.mjs PASSES as the restricted role", asApp.status === 0, `exit ${asApp.status}: ${asApp.out.slice(0, 300)}`);
  const asOwner = runCheck(pgc.url);
  ok("rls-enabled.mjs FAILS as the superuser owner (not vacuous)", asOwner.status === 1, `exit ${asOwner.status}: ${asOwner.out.slice(0, 200)}`);

  // Rollback must be clean.
  applySql(pgc.url, join(ROOT, "drizzle/0002_rls.down.sql"));
  const back = runCheck(pgc.url);
  ok("rollback restores the pre-N04 state", back.status === 1, `exit ${back.status} after down migration`);
} finally {
  stopEphemeral(pgc.name);
}

if (out) writeFileSync(join(ROOT, out), JSON.stringify({ passed: problems.length === 0, results }, null, 2));
for (const r of results) console.log(`  ${r.ok ? "ok  " : "FAIL"}  ${r.name}`);
problems.length ? fail(`${problems.length}/${results.length} tenant-isolation assertion(s) failed`, problems)
                : pass(`all ${results.length} tenant-isolation assertions hold against a real Postgres 17${out ? ` -> ${out}` : ""}`);
