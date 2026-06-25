// One-time (idempotent) database setup, run INSIDE Vercel where the real Neon
// DATABASE_URL exists. Token-gated because the env secrets are "sensitive" and
// can't be pulled locally for `drizzle-kit push`.
//
// Usage (after deploy):
//   curl -X POST https://<deployment>/api/setup -H "x-setup-token: $SETUP_TOKEN"
//
// Creates the tables (CREATE TABLE IF NOT EXISTS) and seeds the CMS-2026 neuro
// wRVU values as the system table. Safe to re-run: the system table is replaced,
// user data is never touched.

import { neon } from "@neondatabase/serverless";
import { db, rvuTables, rvuCodes } from "@/lib/db";
import { and, eq, isNull } from "drizzle-orm";
import { CODES, CF_2026 } from "@/lib/data/cms2026-neuro";

export const runtime = "nodejs";
export const maxDuration = 60;

const DDL = [
  `CREATE TABLE IF NOT EXISTS users (
     id text PRIMARY KEY,
     email text,
     first_name text,
     last_name text,
     role text NOT NULL DEFAULT 'user',
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS user_kv (
     user_id text NOT NULL,
     key text NOT NULL,
     value jsonb,
     updated_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (user_id, key)
   )`,
  `CREATE TABLE IF NOT EXISTS rvu_tables (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     owner_id text,
     name text NOT NULL,
     source text NOT NULL DEFAULT 'custom',
     year integer,
     conversion_factor numeric,
     is_system boolean NOT NULL DEFAULT false,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS rvu_codes (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     table_id uuid NOT NULL REFERENCES rvu_tables(id) ON DELETE CASCADE,
     cpt text NOT NULL,
     modality text,
     region text,
     description text,
     contrast text,
     wrvu numeric NOT NULL,
     meta jsonb
   )`,
  `CREATE INDEX IF NOT EXISTS rvu_codes_table_idx ON rvu_codes (table_id)`,
  `CREATE TABLE IF NOT EXISTS exams (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id text NOT NULL,
     batch_id text NOT NULL,
     exam_date timestamptz,
     cpt text,
     procedure text,
     site text,
     institution text,
     modality text,
     wrvu numeric NOT NULL DEFAULT 0,
     estimated boolean NOT NULL DEFAULT false,
     source text NOT NULL DEFAULT 'screenshot',
     uploaded_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS exams_user_date_idx ON exams (user_id, exam_date)`,
  `CREATE INDEX IF NOT EXISTS exams_user_batch_idx ON exams (user_id, batch_id)`,
];

async function handle(req) {
  const token = req.headers.get("x-setup-token");
  if (!process.env.SETUP_TOKEN || token !== process.env.SETUP_TOKEN) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) return Response.json({ error: "no DATABASE_URL" }, { status: 500 });

  // Read-only verification: ?inspect=1 returns per-user row isolation in user_kv
  // (user ids + which keys each holds + counts). No values exposed.
  if (new URL(req.url).searchParams.get("inspect")) {
    try {
      const sql = neon(url);
      const perUser = await sql`
        SELECT user_id, array_agg(key ORDER BY key) AS keys, count(*)::int AS rows
        FROM user_kv GROUP BY user_id ORDER BY user_id`;
      const totals = await sql`SELECT count(DISTINCT user_id)::int AS users, count(*)::int AS rows FROM user_kv`;
      return Response.json({ ok: true, distinctUsers: totals[0]?.users ?? 0, totalRows: totals[0]?.rows ?? 0, perUser });
    } catch (e) {
      return Response.json({ error: String(e) }, { status: 500 });
    }
  }

  try {
    // 1) Schema
    const sql = neon(url);
    for (const stmt of DDL) await sql(stmt);

    // 2) Seed system CMS-2026 table (replace any prior one)
    await db.delete(rvuTables).where(and(isNull(rvuTables.ownerId), eq(rvuTables.source, "CMS-2026")));
    const [table] = await db
      .insert(rvuTables)
      .values({
        ownerId: null,
        name: "CMS 2026 — Neuroradiology (Professional wRVU)",
        source: "CMS-2026",
        year: 2026,
        conversionFactor: String(CF_2026),
        isSystem: true,
      })
      .returning();

    await db.insert(rvuCodes).values(
      CODES.map((c) => ({
        tableId: table.id,
        cpt: c.cpt,
        modality: c.mod,
        region: c.region,
        description: c.desc,
        contrast: c.con,
        wrvu: String(c.wrvu),
        meta: { est: c.est ?? false, flag: c.flag ?? null },
      })),
    );

    return Response.json({ ok: true, tablesCreated: DDL.length, seededTable: table.id, seededCodes: CODES.length });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

export const POST = handle;
export const GET = handle;
