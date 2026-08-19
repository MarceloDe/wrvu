#!/usr/bin/env node
// INV-TENANT, the half rls-enabled.mjs cannot see.
//
// Migration 0002 left this in place:
//     alter default privileges in schema public
//       grant select, insert, update, delete on tables to app_authenticated;
// so EVERY table subsequently created in `public` is granted to the application role
// automatically, at creation, with nobody deciding it. rls-enabled.mjs only inspects
// tables that carry a user_id, so a table without one is both exposed and invisible.
//
// That is not hypothetical. exams_reprice_log — every tenant's before/after wRVU — was
// created by the N20b tooling and was immediately readable by app_rls. `revoke ... from
// public` did not help, because the grant is to app_authenticated, not to PUBLIC.
//
// So: every table in `public` must be one of three things, and saying which is mandatory.
//   tenant     carries user_id AND has FORCE RLS with a policy   (rls-enabled.mjs checks the detail)
//   shared     deliberately readable by everyone signed in       (reference data, no tenant dimension)
//   operator   NOT reachable by the application role at all
// A table nobody has classified fails. That is the point: the default is exposure, so
// the default must be a failing build.
import { pass, fail, pending } from "./_lib.mjs";
import pg from "pg";

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const urlEnv = arg("--url-env");
const url = urlEnv ? process.env[urlEnv] : (process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);
if (!url) pending("no database URL, so live grants cannot be inspected", "run with --env-file=.env.local");

const APP_ROLE = "app_authenticated";

// Every table must appear here. Adding one is a decision someone has to write down.
const CLASSIFICATION = {
  exams: "tenant", extra_duty_periods: "tenant", extra_duty_rates: "tenant",
  user_kv: "tenant", llm_usage: "tenant", llm_rate_buckets: "tenant",
  users: "shared",   // rvu_tables/rvu_codes dropped in 0006 — the reference schema replaced them
  _migrations: "operator",
  exams_reprice_log: "operator",
};

const c = new pg.Client({ connectionString: url });
try { await c.connect(); }
catch (e) { pending(`could not connect (${String(e.message).slice(0, 60)})`, "a reachable database"); }

const tables = (await c.query(
  `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' order by 1`)).rows.map((r) => r.relname);
if (tables.length === 0) fail("zero tables found — wrong database or a silent connection failure");

const grants = (await c.query(
  `select table_name, privilege_type from information_schema.role_table_grants
   where table_schema = 'public' and grantee = $1`, [APP_ROLE])).rows;
const granted = new Map();
for (const g of grants) granted.set(g.table_name, [...(granted.get(g.table_name) ?? []), g.privilege_type]);

const tenantCols = new Set((await c.query(
  `select table_name from information_schema.columns
   where table_schema='public' and column_name='user_id'`)).rows.map((r) => r.table_name));
await c.end();

const problems = [];
for (const t of tables) {
  const kind = CLASSIFICATION[t];
  const privs = granted.get(t) ?? [];
  if (!kind) {
    problems.push(`UNCLASSIFIED  "${t}" is not listed in table-exposure.mjs. It currently grants ${privs.join(",") || "nothing"} to ${APP_ROLE}. Classify it as tenant, shared or operator — the default in this schema is exposure, so silence must fail.`);
    continue;
  }
  if (kind === "operator" && privs.length) {
    problems.push(`EXPOSED  "${t}" is operator-only but grants ${privs.join(",")} to ${APP_ROLE}. Run: revoke all on public.${t} from ${APP_ROLE};`);
  }
  if (kind === "tenant" && !tenantCols.has(t)) {
    problems.push(`MISCLASSIFIED  "${t}" is marked tenant but has no user_id column, so no RLS policy can scope it`);
  }
  if (kind === "shared" && privs.some((p) => p !== "SELECT")) {
    problems.push(`WRITABLE  "${t}" is shared reference data but grants ${privs.filter((p) => p !== "SELECT").join(",")} to ${APP_ROLE}`);
  }
}
for (const t of Object.keys(CLASSIFICATION)) {
  // Operator tables are created on demand by tooling (exams_reprice_log appears only
  // once a reprice has run), so their absence is expected. A missing TENANT or SHARED
  // table is a stale entry that a new table could hide behind.
  if (!tables.includes(t) && CLASSIFICATION[t] !== "operator") {
    problems.push(`STALE  "${t}" is classified ${CLASSIFICATION[t]} but no longer exists — remove it, or a new table can hide behind the entry`);
  }
}

problems.length
  ? fail(`${problems.length} table-exposure problem(s) in schema public`, problems)
  : pass(`all ${tables.length} tables in public are classified and their grants match: ` +
         `${tables.filter((t) => CLASSIFICATION[t] === "tenant").length} tenant, ` +
         `${tables.filter((t) => CLASSIFICATION[t] === "shared").length} shared, ` +
         `${tables.filter((t) => CLASSIFICATION[t] === "operator").length} operator`);
