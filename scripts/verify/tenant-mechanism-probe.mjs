#!/usr/bin/env node
// N04 groundwork — which tenant-identity mechanism can this stack actually carry?
//
// RLS needs the database to know WHO is asking. The app talks to Neon over the
// stateless HTTP driver, where every statement is its own implicit transaction, so a
// session-scoped `SET app.user_id` cannot survive to the next query. This probe
// establishes, against the real dev branch, which of the candidate mechanisms works
// before any policy is written. It writes nothing and creates nothing.
import { pass, fail } from "./_lib.mjs";

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) fail("no DATABASE_URL_UNPOOLED — run with --env-file=.env.local");

const { neon } = await import("@neondatabase/serverless");
const sql = neon(url);
const findings = {};

// (1) Does a GUC set in one HTTP statement leak into the next? It must NOT.
await sql`select set_config('app.user_id', 'leak_probe', false)`;
const leaked = await sql`select current_setting('app.user_id', true) as who`;
findings.gucLeaksAcrossStatements = leaked[0].who === "leak_probe";

// (2) Does the HTTP driver's transaction array hold a SET LOCAL across statements?
try {
  const out = await sql.transaction([
    sql`select set_config('app.user_id', 'txn_probe', true) as set`,
    sql`select current_setting('app.user_id', true) as who`,
  ]);
  findings.setLocalHoldsInHttpTransaction = out[1][0].who === "txn_probe";
} catch (e) {
  findings.setLocalHoldsInHttpTransaction = false;
  findings.transactionError = e.message;
}

// (3) Is Neon RLS (pg_session_jwt) even installable on this project?
const av = await sql`select name, default_version from pg_available_extensions where name = 'pg_session_jwt'`;
findings.pgSessionJwtAvailable = av.length === 1;
findings.pgSessionJwtVersion = av[0]?.default_version ?? null;

// (4) The blocker that makes any policy inert today.
const me = await sql`select current_user as role, rolbypassrls from pg_roles where rolname = current_user`;
findings.appRole = me[0].role;
findings.appRoleBypassesRls = me[0].rolbypassrls;
const owned = await sql`
  select count(*)::int as n from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
  where ns.nspname = 'public' and c.relkind = 'r' and pg_get_userbyid(c.relowner) = current_user`;
findings.tablesOwnedByAppRole = owned[0].n;

console.log(JSON.stringify(findings, null, 2));
pass("tenant-mechanism probe complete — findings above are inputs to the N04 decision, not a verdict");
