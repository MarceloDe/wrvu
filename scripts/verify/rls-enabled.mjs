#!/usr/bin/env node
// INV-TENANT — RLS that actually constrains the role the application connects as.
//
// The previous version checked only relrowsecurity/relforcerowsecurity. That is a
// FALSE-PASS waiting to happen on this exact stack: the app connects as
// `neondb_owner`, which holds rolbypassrls AND owns all ten tables. Turn on FORCE
// ROW LEVEL SECURITY and that old check reports PASS while every policy is inert and
// the connection still reads every tenant's rows. A gate that cannot fail in the
// configuration you are actually in is not a gate.
//
// Four things must hold, and each is checked separately so a failure says which:
//   1. every tenant table has ROW LEVEL SECURITY, and FORCE (so the owner is bound too)
//   2. every tenant table carries at least one policy — RLS with no policy denies all,
//      which is an outage, not security
//   3. no policy is permissive-true, which is a policy that permits everything
//   4. the connecting role has neither BYPASSRLS nor ownership of the tables
//
// Uses node-postgres, not Neon's HTTP driver. The HTTP driver can only reach a Neon
// endpoint, which would make this check impossible to rehearse against the ephemeral
// Postgres the migration harness uses — and an unrehearsable check is one nobody can
// prove passes when the configuration is right. `--url-env` names the variable so a
// connection string never reaches argv (it would land in the transcript and in ps).
import { pass, fail, pending } from "./_lib.mjs";
import pg from "pg";

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const urlEnv = arg("--url-env");
const url = urlEnv ? process.env[urlEnv] : (process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);
if (!url) fail(urlEnv ? `$${urlEnv} is not set` : "no DATABASE_URL — this check inspects a LIVE schema. Run with --env-file=.env.local");

const client = new pg.Client({ connectionString: url });
await client.connect();
const sql = async (strings, ...vals) => {
  let text = strings[0];
  for (let i = 0; i < vals.length; i++) text += `$${i + 1}` + strings[i + 1];
  return (await client.query(text, vals)).rows;
};

const tables = await sql`
  select c.relname, c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) as owner
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
  order by c.relname`;
if (!tables.length) fail("zero tables found — wrong database or a silent connection failure");

// Tenant tables are those carrying a user_id column.
const cols = await sql`
  select table_name from information_schema.columns
  where table_schema = 'public' and column_name = 'user_id'`;
const tenant = new Set(cols.map((c) => c.table_name));

if (tenant.size === 0) {
  pending(`no table carries a user_id column, so there is nothing to scope yet (${tables.length} tables scanned)`,
          "N04 introduces tenant-scoped tables, or the reference schema lands");
}

const policies = await sql`
  select tablename, policyname, permissive, cmd, qual, with_check
  from pg_policies where schemaname = 'public'`;
const byTable = new Map();
for (const p of policies) {
  if (!byTable.has(p.tablename)) byTable.set(p.tablename, []);
  byTable.get(p.tablename).push(p);
}

const me = await sql`select current_user as role, rolbypassrls, rolsuper from pg_roles where rolname = current_user`;
const role = me[0];

const problems = [];

for (const t of tables.filter((t) => tenant.has(t.relname))) {
  if (!t.relrowsecurity)      problems.push(`${t.relname}  ROW LEVEL SECURITY is off`);
  else if (!t.relforcerowsecurity) problems.push(`${t.relname}  RLS is on but not FORCED — the table owner still reads every row`);
  const ps = byTable.get(t.relname) ?? [];
  if (t.relrowsecurity && ps.length === 0) {
    problems.push(`${t.relname}  RLS is on with ZERO policies — this denies every row and takes the app down (INV-ALWAYS-SHIPPABLE)`);
  }
  for (const p of ps) {
    const q = (p.qual ?? "").replace(/\s+/g, " ").trim().toLowerCase();
    if (p.permissive === "PERMISSIVE" && (q === "true" || q === "(true)")) {
      problems.push(`${t.relname}  policy "${p.policyname}" is PERMISSIVE with qual TRUE — it permits every row and is decorative`);
    }
  }
}

// The role check is the one that matters most, and the one the old version omitted.
if (role.rolsuper)      problems.push(`the connecting role "${role.role}" is SUPERUSER — RLS never applies to it`);
if (role.rolbypassrls)  problems.push(`the connecting role "${role.role}" holds BYPASSRLS — every policy above is inert for this connection`);
const owned = tables.filter((t) => tenant.has(t.relname) && t.owner === role.role).map((t) => t.relname);
if (owned.length) {
  problems.push(`the connecting role "${role.role}" OWNS ${owned.length} tenant table(s) (${owned.slice(0, 4).join(", ")}${owned.length > 4 ? ", …" : ""}) — an owner is exempt from RLS unless it is FORCED, and can drop the policies outright`);
}

await client.end();

if (problems.length) fail(`${problems.length} problem(s): RLS does not constrain the application's connection`, problems);
pass(`all ${tenant.size} tenant table(s) FORCE RLS with scoping policies; role "${role.role}" has no BYPASSRLS and owns none of them`);
