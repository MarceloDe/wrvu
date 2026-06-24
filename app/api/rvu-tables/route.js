// wRVU fee-schedule tables API.
//   GET                  -> list tables visible to the user (system + own) with code counts
//   GET ?tableId=<uuid>  -> the codes inside one table (must be system or owned)
//   POST { name, codes } -> create a new user/company table (future ingestion path)
//
// This is the foundation for "users ingest their company's own wRVU table":
// the dashboard seeds from the system CMS-2026 table today; tomorrow a user can
// upload their own and switch the active schedule.

import { auth } from "@clerk/nextjs/server";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db, rvuTables, rvuCodes } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  const tableId = new URL(req.url).searchParams.get("tableId");

  if (tableId) {
    // Authorize: table must be system or owned by this user.
    const [t] = await db.select().from(rvuTables).where(eq(rvuTables.id, tableId)).limit(1);
    if (!t || (!t.isSystem && t.ownerId !== userId)) {
      return Response.json({ error: "not found" }, { status: 404 });
    }
    const codes = await db.select().from(rvuCodes).where(eq(rvuCodes.tableId, tableId));
    return Response.json({ table: t, codes });
  }

  const tables = await db
    .select({
      id: rvuTables.id,
      name: rvuTables.name,
      source: rvuTables.source,
      year: rvuTables.year,
      isSystem: rvuTables.isSystem,
      ownerId: rvuTables.ownerId,
      codeCount: sql`count(${rvuCodes.id})`.mapWith(Number),
    })
    .from(rvuTables)
    .leftJoin(rvuCodes, eq(rvuCodes.tableId, rvuTables.id))
    .where(or(eq(rvuTables.isSystem, true), eq(rvuTables.ownerId, userId)))
    .groupBy(rvuTables.id);

  return Response.json({ tables });
}

export async function POST(req) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const { name, year, source = "company-upload", codes = [] } = await req.json();
    if (!name) return Response.json({ error: "name required" }, { status: 400 });

    const [table] = await db
      .insert(rvuTables)
      .values({ ownerId: userId, name, source, year, isSystem: false })
      .returning();

    if (Array.isArray(codes) && codes.length) {
      await db.insert(rvuCodes).values(
        codes.map((c) => ({
          tableId: table.id,
          cpt: String(c.cpt ?? ""),
          modality: c.mod ?? c.modality ?? null,
          region: c.region ?? null,
          description: c.desc ?? c.description ?? null,
          contrast: c.con ?? c.contrast ?? null,
          wrvu: String(c.wrvu ?? 0),
          meta: c.meta ?? { est: c.est ?? false, flag: c.flag ?? null },
        })),
      );
    }
    return Response.json({ table });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
