#!/usr/bin/env node
// Give app_rls a login password, without any human or agent ever seeing it.
//
// The password is generated here with crypto.randomBytes, applied over the existing
// owner connection, and written straight into .env.local. It is never printed, never
// passed as an argument (argv is world-readable via ps and lands in shell history),
// and never returned. What IS printed is a sha256 prefix, which is enough to confirm
// that the value in .env.local is the value the database received, and useless to
// anyone who reads the log.
//
// Run it again at any time to rotate. It is idempotent.
//
// This does NOT point the application at app_rls. It only adds DATABASE_URL_RLS
// alongside the owner URLs. Switching over is a separate, deliberate step — a
// connection without BYPASSRLS reads zero rows until the scoped client ships.
import pg from "pg";
import { randomBytes, createHash } from "node:crypto";
import { readFileSync, writeFileSync, chmodSync, existsSync } from "node:fs";

const ROLE = "app_rls";
const ENV = ".env.local";

if (!existsSync(ENV)) { console.error(`FAIL  ${ENV} not found`); process.exit(1); }
const ownerUrl = process.env.DATABASE_URL_UNPOOLED;
const ownerPooled = process.env.DATABASE_URL;
if (!ownerUrl || !ownerPooled) { console.error("FAIL  run with --env-file=.env.local"); process.exit(1); }

// base64url: safe in a URL userinfo field with no percent-encoding, 192 bits.
const password = randomBytes(24).toString("base64url");
const fingerprint = createHash("sha256").update(password).digest("hex").slice(0, 12);

const c = new pg.Client({ connectionString: ownerUrl });
await c.connect();
try {
  const existing = await c.query(`select 1 from pg_roles where rolname = $1`, [ROLE]);
  if (!existing.rowCount) { console.error(`FAIL  role ${ROLE} does not exist — create it first (see goals/runbooks/N04-rls-activation.md)`); process.exit(1); }
  // ALTER ROLE cannot take a bind parameter, so the literal is escaped by the driver.
  await c.query(`alter role ${ROLE} with login password ${c.escapeLiteral(password)}`);
  await c.query(`grant app_authenticated to ${ROLE}`);
  const attrs = await c.query(`select rolbypassrls, rolsuper, rolcanlogin from pg_roles where rolname = $1`, [ROLE]);
  const a = attrs.rows[0];
  if (a.rolbypassrls || a.rolsuper) { console.error(`FAIL  ${ROLE} has bypassrls=${a.rolbypassrls} super=${a.rolsuper} — it would ignore every policy. Do not use it.`); process.exit(1); }
  if (!a.rolcanlogin) { console.error(`FAIL  ${ROLE} still cannot log in`); process.exit(1); }
} finally { await c.end(); }

const withRole = (u) => { const x = new URL(u); x.username = ROLE; x.password = password; return x.toString(); };
const lines = readFileSync(ENV, "utf8").split("\n");
const upsert = (key, value) => {
  const i = lines.findIndex((l) => l.startsWith(`${key}=`));
  const line = `${key}=${value}`;
  if (i > -1) lines[i] = line; else lines.push(line);
};
upsert("DATABASE_URL_RLS", withRole(ownerPooled));
upsert("DATABASE_URL_RLS_UNPOOLED", withRole(ownerUrl));
writeFileSync(ENV, lines.join("\n"));
chmodSync(ENV, 0o600);

// Prove the credential works, as the role itself, before claiming success.
const asRole = new pg.Client({ connectionString: withRole(ownerUrl) });
await asRole.connect();
const who = await asRole.query(`select current_user u, (select rolbypassrls from pg_roles where rolname = current_user) b`);
await asRole.end();
if (who.rows[0].u !== ROLE || who.rows[0].b !== false) { console.error(`FAIL  connected as ${who.rows[0].u} bypassrls=${who.rows[0].b}`); process.exit(1); }

console.log(`PASS  ${ROLE} can log in, holds no BYPASSRLS, and is a member of app_authenticated`);
console.log(`      DATABASE_URL_RLS and DATABASE_URL_RLS_UNPOOLED written to ${ENV} (mode 600, gitignored)`);
console.log(`      secret fingerprint sha256:${fingerprint}  — the password itself was never printed or logged`);
console.log(`      the app still connects as the owner; nothing switched over`);
