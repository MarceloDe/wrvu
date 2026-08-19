#!/usr/bin/env node
// Does withTenant() actually work against a connection that CANNOT bypass RLS?
//
// verify:shippable proves the app compiles and its unit tests pass. Neither notices
// that every tenant query now returns zero rows, because today's connection is
// neondb_owner and BYPASSRLS makes the policies invisible. The bug this catches only
// appears at the moment of rotation — which is the worst possible moment to find it.
//
// So: run the application's OWN data path, through lib/db, over a connection with no
// BYPASSRLS, and assert both directions — that scoped access WORKS, and that unscoped
// access sees NOTHING. The second half matters as much as the first: if unscoped reads
// still returned rows, withTenant would be decoration.
import { pass, fail, pending } from "./_lib.mjs";
import { writeFileSync } from "node:fs";

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const out = arg("--out");

const rlsUrl = process.env.DATABASE_URL_RLS;
if (!rlsUrl) pending("DATABASE_URL_RLS is not set, so there is no non-privileged connection to test",
                     "scripts/ops/set-rls-password.mjs has run and written DATABASE_URL_RLS");

// lib/db reads DATABASE_URL. Point it at the restricted role for this process only.
process.env.DATABASE_URL = rlsUrl;
const { withTenant, getUnscopedSql, UnscopedAccessError } = await import("../../lib/db/index.js");

const A = "scoped_probe_a_synthetic", B = "scoped_probe_b_synthetic";
const results = [];
const problems = [];
const ok = (name, cond, detail) => { results.push({ name, ok: !!cond, detail }); if (!cond) problems.push(`${name}: ${detail}`); };

const owner = process.env.DATABASE_URL_UNPOOLED;
if (!owner) fail("DATABASE_URL_UNPOOLED (owner) is needed to seed and clean up");
const pg = (await import("pg")).default;
const admin = new pg.Client({ connectionString: owner });
await admin.connect();

const preexisting = await admin.query(`select count(*)::int n from exams`);
if (preexisting.rows[0].n > 0) fail(`refusing: exams holds ${preexisting.rows[0].n} row(s). This probe writes and deletes; never run it against real data`);

try {
  // 1. The role really is unprivileged, or nothing below means anything.
  const attrs = await admin.query(`select rolbypassrls b, rolsuper s from pg_roles where rolname = $1`, [new URL(rlsUrl).username]);
  ok("the connection under test cannot bypass RLS", attrs.rows[0] && !attrs.rows[0].b && !attrs.rows[0].s,
     `role ${new URL(rlsUrl).username} -> ${JSON.stringify(attrs.rows[0])}`);

  // 2. A scoped WRITE lands. This is the one that breaks if SET LOCAL is not reaching
  //    the statement — the insert would be rejected by the WITH CHECK clause.
  await withTenant(A, async ({ sql }) => {
    await sql`insert into exams (user_id, batch_id, cpt, wrvu) values (${A}, 'p1', '70551', 1.5)`;
    await sql`insert into exams (user_id, batch_id, cpt, wrvu) values (${A}, 'p1', '70553', 2.29)`;
  });
  await withTenant(B, async ({ sql }) => {
    await sql`insert into exams (user_id, batch_id, cpt, wrvu) values (${B}, 'p2', '70553', 2.29)`;
  });
  const seeded = await admin.query(`select user_id, count(*)::int n from exams group by 1 order by 1`);
  ok("scoped WRITE lands for both tenants", seeded.rows.length === 2, JSON.stringify(seeded.rows));

  // 3. A scoped READ returns own rows — the regression that would empty the dashboard.
  const mine = await withTenant(A, ({ sql }) => sql`select id from exams`);
  ok("scoped READ returns the tenant's own rows", mine.length === 2, `expected 2, got ${mine.length}`);

  // 4. And cannot reach the other tenant.
  const theirs = await withTenant(A, ({ sql }) => sql`select id from exams where user_id = ${B}`);
  ok("scoped READ cannot reach another tenant", theirs.length === 0, `saw ${theirs.length} of B's rows`);

  // 5. Drizzle goes through the same transaction, not a second connection.
  const { exams: examsTable } = await import("../../lib/db/schema.js");
  const viaDrizzle = await withTenant(A, ({ db }) => db.select().from(examsTable));
  ok("the drizzle client is scoped too, not a separate connection", viaDrizzle.length === 2, `expected 2, got ${viaDrizzle.length}`);

  // 6. Forging another tenant inside your own scope is refused.
  let forged = false, forgeErr = "";
  try { await withTenant(A, ({ sql }) => sql`insert into exams (user_id, batch_id, cpt, wrvu) values (${B}, 'p3', '70553', 2.29)`); }
  catch (e) { forged = true; forgeErr = e.message; }
  ok("a scoped connection cannot forge a row for another tenant", forged, forged ? forgeErr.slice(0, 120) : "the insert SUCCEEDED");

  // 7. UNSCOPED access sees nothing. If this ever returns rows, withTenant is theatre.
  const bare = await getUnscopedSql()`select count(*)::int as n from exams`;
  ok("UNSCOPED access sees zero tenant rows", Number(bare[0].n) === 0, `unscoped read returned ${bare[0].n} row(s) — RLS is not constraining this connection`);

  // 8. An empty tenant is refused loudly rather than quietly reading nothing.
  let refused = false;
  try { await withTenant("", ({ sql }) => sql`select 1`); } catch (e) { refused = e instanceof UnscopedAccessError; }
  ok("withTenant refuses an empty userId", refused, "an empty tenant would read zero rows and look like an empty account");
} finally {
  await admin.query(`delete from exams where user_id in ($1,$2)`, [A, B]);
  const left = await admin.query(`select count(*)::int n from exams`);
  console.log(`  cleanup: ${left.rows[0].n} row(s) remain in exams (expected 0)`);
  await admin.end();
}

if (out) writeFileSync(out, JSON.stringify({ passed: problems.length === 0, results }, null, 2));
for (const r of results) console.log(`  ${r.ok ? "ok  " : "FAIL"}  ${r.name}`);
problems.length ? fail(`${problems.length}/${results.length} scoped-client assertion(s) failed`, problems)
                : pass(`withTenant() works against a connection with no BYPASSRLS — all ${results.length} assertions`);
