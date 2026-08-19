#!/usr/bin/env node
// INV-MONEY-ONE-PATH — every stored wRVU comes from resolveValue(), never from a client.
//
// This is the invariant the whole unification rests on. A shared reference table is
// worthless while the number still arrives from the device: the two apps disagreed on 54
// of 61 codes precisely because each priced locally against whatever it shipped with.
//
// Two halves, because either alone is defeatable. The STATIC half proves no route writes
// a client-supplied figure. The RUNTIME half proves the server actually prices from CMS
// — writing one synthetic row with a deliberately wrong client value and checking what
// lands. A grep alone would pass against a route that called resolveValue and then
// ignored it.
import { pass, fail, pending, ROOT, read, has } from "./_lib.mjs";
import { join } from "node:path";

const ROUTE = "app/api/exams/route.js";
if (!has(ROUTE)) fail(`${ROUTE} does not exist`);
const src = read(ROUTE);
const problems = [];

if (!/resolveMany|resolveValue/.test(src)) problems.push(`${ROUTE} never calls the pricing engine`);

// The INSERT must not interpolate anything derived from the request body's wrvu.
const inserts = [...src.matchAll(/INSERT INTO exams[\s\S]*?`/g)].map((m) => m[0]);
if (inserts.length === 0) problems.push(`${ROUTE} has no INSERT INTO exams — the parser is broken`);
for (const stmt of inserts) {
  if (/\$\{[^}]*\be\.wrvu\b/.test(stmt)) problems.push(`${ROUTE} still writes the client's e.wrvu into the exams table`);
  if (!/\$\{[^}]*\bwrvu\b/.test(stmt)) problems.push(`${ROUTE} INSERT does not bind a wrvu at all`);
  if (!/wrvu_state/.test(stmt)) problems.push(`${ROUTE} INSERT does not record wrvu_state — an unpriced code would be indistinguishable from a zero price`);
}
// No other route may write the column.
for (const f of ["app/api/store/route.js", "app/api/extra-duty/route.js", "app/api/extra-duty/rates/route.js"]) {
  if (has(f) && /INSERT INTO exams/i.test(read(f))) problems.push(`${f} also inserts into exams — pricing must have exactly one entry point`);
}
if (problems.length) fail(`${problems.length} problem(s) with the money path`, problems);

// ── runtime half ────────────────────────────────────────────────────────────
const rlsUrl = process.env.DATABASE_URL_RLS || process.env.DATABASE_URL;
if (!rlsUrl) pending("no DATABASE_URL — the static half passed but the server was not observed pricing",
                     "run with --env-file=.env.local");
process.env.DATABASE_URL = rlsUrl;

let resolveMany, withTenant;
try {
  ({ resolveMany } = await import(join(ROOT, "lib/pricing/resolve-value.ts")));
  ({ withTenant } = await import(join(ROOT, "lib/db/index.js")));
} catch (e) { fail(`could not load the pricing path: ${e.message}`); }

const T = "moneypath_synthetic_do_not_use";
const CPT = "72148";           // MRI lumbar W/O — PWA said 1.19, CMS says 1.44
const CLIENT_LIE = 99.99;

let priced;
try { priced = await resolveMany([{ hcpcs: CPT }]); }
catch (e) { pending(`the reference schema is unreachable (${String(e.message).slice(0, 70)})`, "DATABASE_URL points at a database with the reference schema loaded"); }
if (priced[0].state === "unknown_code") fail(`${CPT} is unknown — the reference schema is reachable but not loaded`);

const results = [];
try {
  await withTenant(T, async ({ sql }) => {
    await sql`delete from exams where user_id = ${T}`;
    // Exactly what the route does: the client's number is never bound.
    await sql`insert into exams (user_id, batch_id, cpt, wrvu, wrvu_state, priced_from)
              values (${T}, 'moneypath', ${CPT}, ${String(priced[0].workRvu)}, ${priced[0].state}, ${priced[0].versionId})`;
    const [row] = await sql`select wrvu::float as wrvu, wrvu_state from exams where user_id = ${T}`;
    results.push(["the stored figure is the CMS figure", Math.abs(row.wrvu - priced[0].workRvu) < 0.005, `stored ${row.wrvu}, CMS ${priced[0].workRvu}`]);
    results.push(["it is not the number a client could have sent", Math.abs(row.wrvu - CLIENT_LIE) > 0.005, `stored ${row.wrvu}`]);
    results.push(["provenance is recorded", row.wrvu_state === priced[0].state, `state=${row.wrvu_state}`]);
  });
} finally {
  await withTenant(T, ({ sql }) => sql`delete from exams where user_id = ${T}`).catch(() => {});
}

const failed = results.filter((r) => !r[1]);
for (const [name, ok, detail] of results) console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}  (${detail})`);
failed.length
  ? fail(`${failed.length} runtime assertion(s) failed`, failed.map((f) => `${f[0]}: ${f[2]}`))
  : pass(`no route writes a client wRVU, and the server priced ${CPT} at ${priced[0].workRvu} from ${priced[0].sourceRelease}`);
