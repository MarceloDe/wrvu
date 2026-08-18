// wRVU fee-schedule tables API.
//   GET                  -> list tables visible to the user (system + own) with code counts
//   GET ?tableId=<uuid>  -> the codes inside one table (must be system or owned)
//   POST { name, codes } -> create a new user/company table (future ingestion path)
//
// This is the foundation for "users ingest their company's own wRVU table":
// the dashboard seeds from the system CMS-2026 table today; tomorrow a user can
// upload their own and switch the active schedule.

import { auth } from "@clerk/nextjs/server";
import { eq, or, sql } from "drizzle-orm";
import { getDb, rvuTables, rvuCodes } from "@/lib/db";
import { withErrorEnvelope } from "@/lib/http/errors";

export const runtime = "nodejs";

export const GET = withErrorEnvelope("/api/rvu-tables", async (req, ctx) => {
  const { userId } = await auth();
  if (!userId) return ctx.fail("unauthorized", 401);

  const tableId = new URL(req.url).searchParams.get("tableId");

  try {
    const db = getDb();
    if (tableId) {
      // Authorize: table must be system or owned by this user.
      const [t] = await db.select().from(rvuTables).where(eq(rvuTables.id, tableId)).limit(1);
      if (!t || (!t.isSystem && t.ownerId !== userId)) {
        return ctx.fail("not_found", 404, { message: `table ${tableId} not visible to this user` });
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
  } catch (err) {
    return ctx.fail("storage_unavailable", 503, { cause: err, message: "rvu tables read failed" });
  }
});

export const POST = withErrorEnvelope("/api/rvu-tables", async (req, ctx) => {
  const { userId } = await auth();
  if (!userId) return ctx.fail("unauthorized", 401);
  let body;
  try {
    body = await req.json();
  } catch (err) {
    return ctx.fail("invalid_json", 400, { cause: err });
  }
  const { name, year, source = "company-upload", codes = [] } = body || {};
  if (!name) return ctx.fail("validation_failed", 400, { message: "name required" });

  try {
    const db = getDb();
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
  } catch (err) {
    return ctx.fail("storage_unavailable", 503, { cause: err, message: "rvu table write failed" });
  }
});
