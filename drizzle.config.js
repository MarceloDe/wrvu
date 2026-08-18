/** @type {import('drizzle-kit').Config} */

// Migrations MUST use the UNPOOLED connection. DATABASE_URL points at Neon's
// pgBouncer pooler, and pgBouncer in transaction mode breaks session-level DDL
// (CREATE INDEX CONCURRENTLY, advisory locks, SET LOCAL across statements) —
// which is exactly what drizzle-kit needs. App queries keep using the pooled
// DATABASE_URL via lib/db/index.js; only schema operations come through here.
const migrationUrl =
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL;

if (!migrationUrl) {
  throw new Error(
    "drizzle-kit: no connection string. Set DATABASE_URL_UNPOOLED (preferred) " +
      "or POSTGRES_URL_NON_POOLING. Pull them with `vercel env pull .env.local`."
  );
}

if (!process.env.DATABASE_URL_UNPOOLED && !process.env.POSTGRES_URL_NON_POOLING) {
  console.warn(
    "[drizzle] Falling back to the POOLED connection string. Session-level DDL " +
      "may fail through pgBouncer. Prefer DATABASE_URL_UNPOOLED."
  );
}

export default {
  schema: "./lib/db/schema.js",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: migrationUrl },
};
