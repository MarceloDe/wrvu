// Neon serverless + Drizzle client. The Vercel Neon integration injects
// DATABASE_URL (and POSTGRES_URL) automatically when you connect the database
// to the project. We prefer DATABASE_URL and fall back to POSTGRES_URL.
//
// The client is built lazily, on first use inside a request. That is deliberate:
// a missing/unreachable connection string must surface as a thrown error INSIDE
// a route handler — where withErrorEnvelope() turns it into a logged, correlated
// generic response — instead of crashing at module load, where the failure would
// escape the envelope as a framework stack trace (INV-NO-RAW-ERRORS).

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

function connectionString() {
  const cs = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!cs) {
    const err = new Error("DATABASE_URL / POSTGRES_URL is not set — connect the Neon integration.");
    err.code = "db_not_configured";
    throw err;
  }
  return cs;
}

/** Raw tagged-template SQL client (used by the routes that hand-write SQL). */
export function getSql() {
  return neon(connectionString());
}

let cachedDb = null;
let cachedFor = null;

/** Drizzle client. Throws if the database is not configured. */
export function getDb() {
  const cs = connectionString();
  if (cachedDb && cachedFor === cs) return cachedDb;
  cachedDb = drizzle(neon(cs), { schema });
  cachedFor = cs;
  return cachedDb;
}

export * from "./schema";
