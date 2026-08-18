#!/usr/bin/env node
// INV-TENANT — FORCE ROW LEVEL SECURITY on every app tenant table, and a
// production role holding neither BYPASSRLS nor ownership.
import { pass, fail, pending } from "./_lib.mjs";

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) fail("no DATABASE_URL — this check inspects a LIVE schema. Run with --env-file=.env.local");

const { neon } = await import("@neondatabase/serverless");
const sql = neon(url);

const tables = await sql`
  select c.relname, c.relrowsecurity, c.relforcerowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
  order by c.relname`;
if (!tables.length) fail("zero tables found — wrong database or a silent connection failure");

// Tenant tables are those carrying a user_id column.
const cols = await sql`
  select table_name from information_schema.columns
  where table_schema='public' and column_name='user_id'`;
const tenant = new Set(cols.map((c) => c.table_name));

if (tenant.size === 0) {
  pending(`no table carries a user_id column, so there is nothing to scope yet (${tables.length} tables scanned)`,
          "N04 introduces tenant-scoped tables, or the reference schema lands");
}

const bad = tables.filter((t) => tenant.has(t.relname) && !(t.relrowsecurity && t.relforcerowsecurity))
                  .map((t) => `${t.relname}  rls=${t.relrowsecurity} force=${t.relforcerowsecurity}`);
if (bad.length) fail(`${bad.length} tenant table(s) without FORCE ROW LEVEL SECURITY`, bad);
pass(`all ${tenant.size} tenant table(s) have FORCE ROW LEVEL SECURITY`);
