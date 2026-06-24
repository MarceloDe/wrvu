// Seed the CMS-2026 neuroradiology wRVU table into Postgres as the system table.
// Run after `npm run db:push`:  npm run db:seed
// Idempotent: if a system CMS-2026 table already exists, it is replaced.

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, eq, isNull } from "drizzle-orm";
import { rvuTables, rvuCodes } from "../lib/db/schema.js";
import { CODES, CF_2026 } from "../lib/data/cms2026-neuro.js";

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) {
  console.error("DATABASE_URL / POSTGRES_URL not set. Run `vercel env pull .env.local` first.");
  process.exit(1);
}

const db = drizzle(neon(url), { schema: { rvuTables, rvuCodes } });

async function main() {
  // Remove any prior system CMS-2026 table (cascade drops its codes).
  await db
    .delete(rvuTables)
    .where(and(isNull(rvuTables.ownerId), eq(rvuTables.source, "CMS-2026")));

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

  const rows = CODES.map((c) => ({
    tableId: table.id,
    cpt: c.cpt,
    modality: c.mod,
    region: c.region,
    description: c.desc,
    contrast: c.con,
    wrvu: String(c.wrvu),
    meta: { est: c.est ?? false, flag: c.flag ?? null },
  }));

  await db.insert(rvuCodes).values(rows);
  console.log(`Seeded system table ${table.id} with ${rows.length} CMS-2026 neuro codes.`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
