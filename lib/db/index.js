// Database access, in two deliberately unequal halves.
//
// TENANT DATA goes through withTenant(userId, fn). It opens a transaction, sets
// `app.user_id` with SET LOCAL, and hands you a client scoped to that user. The RLS
// policies in drizzle/0002_rls.sql read that GUC, so a query issued any other way
// returns nothing once the connection loses BYPASSRLS.
//
// REFERENCE DATA goes through getUnscopedDb()/getUnscopedSql(). Those names are
// deliberately ugly and greppable. The previous names were getDb()/getSql(), and
// renaming them was the point of this change: every call site had to be visited and
// classified, and a new one cannot reach tenant data by accident — it has to type the
// word "unscoped" first.
//
// WHY A TRANSACTION AT ALL. The app talks to Neon over a stateless driver where each
// statement is its own implicit transaction, so a session-level SET does not survive
// to the next query. tenant-mechanism-probe.mjs measured this against the real branch:
// a GUC set in one HTTP statement does NOT leak into the next. That is good for
// isolation and fatal for session-scoped identity, so the identity has to travel
// inside the transaction that uses it.
//
// WHY NODE-POSTGRES FOR THE SCOPED HALF. Neon's HTTP driver has no interactive
// transactions, and drizzle cannot express `SET LOCAL then N statements` over it. The
// pooled endpoint is PgBouncer in transaction mode, where SET LOCAL is exactly the
// construct that is safe.
//
// The client is built lazily, on first use inside a request. That is deliberate: a
// missing or unreachable connection string must surface as a thrown error INSIDE a
// route handler — where withErrorEnvelope() turns it into a logged, correlated generic
// response — instead of crashing at module load, where the failure would escape the
// envelope as a framework stack trace (INV-NO-RAW-ERRORS).

import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleHttp } from "drizzle-orm/neon-http";
import { drizzle as drizzleNode } from "drizzle-orm/node-postgres";
import { sql as drizzleSql } from "drizzle-orm";
import pg from "pg";
import * as schema from "./schema.js";

function connectionString() {
  const cs = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!cs) {
    const err = new Error("DATABASE_URL / POSTGRES_URL is not set — connect the Neon integration.");
    err.code = "db_not_configured";
    throw err;
  }
  return cs;
}

// ── Reference data (no user_id column, no RLS) ───────────────────────────────

/** Raw tagged-template SQL over reference tables. NOT tenant-scoped. */
export function getUnscopedSql() {
  return neon(connectionString());
}

let cachedDb = null;
let cachedFor = null;

/** Drizzle client over reference tables. NOT tenant-scoped. */
export function getUnscopedDb() {
  const cs = connectionString();
  if (cachedDb && cachedFor === cs) return cachedDb;
  cachedDb = drizzleHttp(neon(cs), { schema });
  cachedFor = cs;
  return cachedDb;
}

// ── Tenant data ──────────────────────────────────────────────────────────────

let pool = null;
let poolFor = null;

function getPool() {
  const cs = connectionString();
  if (pool && poolFor === cs) return pool;
  // Small on purpose. Fluid Compute reuses instances across concurrent requests, so a
  // handful of sockets per instance is plenty and keeps well clear of Neon's limits.
  pool = new pg.Pool({ connectionString: cs, max: 5, idleTimeoutMillis: 30_000 });
  poolFor = cs;
  return pool;
}

export class UnscopedAccessError extends Error {
  constructor(msg) { super(msg); this.name = "UnscopedAccessError"; this.code = "unscoped_tenant_access"; }
}

/**
 * Run `fn` with the tenant declared to Postgres for the duration of one transaction.
 *
 * @param {string} userId  Clerk user id. MUST come from auth(), never from input.
 * @param {(scope: {db: object, sql: Function, tx: object}) => Promise<T>} fn
 * @returns {Promise<T>}
 *
 * `scope.sql` is a tagged template returning a rows array, matching the shape the
 * routes already used. There is no scope.sql.transaction(): you are already in one,
 * and nesting would silently discard the SET LOCAL.
 */
export async function withTenant(userId, fn) {
  if (typeof userId !== "string" || userId.length === 0) {
    // Not a 500 waiting to happen further down. An empty tenant would leave app.user_id
    // unset, and the policies would return zero rows — which reads exactly like "this
    // user has no data" and would be debugged for hours.
    throw new UnscopedAccessError("withTenant requires a non-empty userId from auth()");
  }
  const client = await getPool().connect();
  try {
    await client.query("begin");
    // set_config(..., true) is SET LOCAL: it reverts at commit or rollback, so a pooled
    // connection cannot carry one request's identity into the next.
    await client.query("select set_config('app.user_id', $1, true)", [userId]);

    const sql = async (strings, ...vals) => {
      let text = strings[0];
      for (let i = 0; i < vals.length; i++) text += `$${i + 1}` + strings[i + 1];
      return (await client.query(text, vals)).rows;
    };
    const db = drizzleNode(client, { schema });

    const out = await fn({ db, sql, tx: client });
    await client.query("commit");
    return out;
  } catch (err) {
    try { await client.query("rollback"); } catch { /* the connection is already gone */ }
    throw err;
  } finally {
    client.release();
  }
}

/** Escape hatch for scripts and tests that need the raw GUC name. */
export const TENANT_GUC = "app.user_id";
export { drizzleSql };

export * from "./schema.js";
