// Per-user exam store (source of truth for tracker/timeline).
//   GET                     -> all exams for the user (ordered by exam date)
//   GET ?batches=1          -> batch/cluster summaries (count, date range, sites)
//   POST {batchId, source, exams:[...]}  -> bulk insert one upload batch
//   DELETE ?batchId=        -> delete a cluster
//   DELETE ?examDate=YYYY-MM-DD   -> delete by exam date (day)
//   DELETE ?uploadDate=YYYY-MM-DD -> delete by upload date (day)
//   DELETE ?id=             -> delete a single exam
// Every query is scoped to the signed-in Clerk user id.

import { auth } from "@clerk/nextjs/server";
import { withTenant } from "@/lib/db";
import { withErrorEnvelope } from "@/lib/http/errors";

export const runtime = "nodejs";

export const GET = withErrorEnvelope("/api/exams", async (req, ctx) => {
  const { userId } = await auth();
  if (!userId) return ctx.fail("unauthorized", 401);
  const { searchParams } = new URL(req.url);

  try {
    return await withTenant(userId, async ({ sql }) => {
    if (searchParams.get("batches")) {
      const batches = await sql`
        SELECT batch_id AS "batchId",
               min(uploaded_at) AS "uploadedAt",
               count(*)::int     AS count,
               min(exam_date)    AS "firstExam",
               max(exam_date)    AS "lastExam",
               coalesce(sum(wrvu), 0)::float AS wrvu,
               array_remove(array_agg(DISTINCT site), NULL) AS sites
        FROM exams WHERE user_id = ${userId}
        GROUP BY batch_id ORDER BY min(uploaded_at) DESC`;
      return Response.json({ batches });
    }

    const exams = await sql`
      SELECT id, batch_id AS "batchId", exam_date AS "examDate", cpt, procedure, site,
             institution, modality, wrvu::float AS wrvu, estimated, source, uploaded_at AS "uploadedAt"
      FROM exams WHERE user_id = ${userId}
      ORDER BY exam_date NULLS LAST`;
    return Response.json({ exams });
    });
  } catch (err) {
    return ctx.fail("storage_unavailable", 503, { cause: err, message: "exams read failed" });
  }
});

export const POST = withErrorEnvelope("/api/exams", async (req, ctx) => {
  const { userId } = await auth();
  if (!userId) return ctx.fail("unauthorized", 401);
  let body;
  try {
    body = await req.json();
  } catch (err) {
    return ctx.fail("invalid_json", 400, { cause: err });
  }
  const { batchId, source = "screenshot", exams = [] } = body || {};
  if (!batchId || !Array.isArray(exams) || !exams.length) {
    return ctx.fail("validation_failed", 400, { message: "batchId and non-empty exams[] required" });
  }
  try {
    // Already inside ONE transaction via withTenant, so the batch is still atomic —
    // sql.transaction() is gone because nesting would discard the SET LOCAL.
    await withTenant(userId, async ({ sql }) => {
      for (const e of exams) {
        await sql`
          INSERT INTO exams (user_id, batch_id, exam_date, cpt, procedure, site, institution, modality, wrvu, estimated, source)
          VALUES (${userId}, ${batchId}, ${e.examDate || null}, ${e.cpt || null}, ${e.procedure || null},
                  ${e.site || null}, ${e.institution || null}, ${e.modality || null},
                  ${String(e.wrvu ?? 0)}, ${!!e.estimated}, ${source})`;
      }
    });
    return Response.json({ ok: true, inserted: exams.length, batchId });
  } catch (err) {
    return ctx.fail("storage_unavailable", 503, { cause: err, message: `exam batch write failed for ${batchId}` });
  }
});

export const DELETE = withErrorEnvelope("/api/exams", async (req, ctx) => {
  const { userId } = await auth();
  if (!userId) return ctx.fail("unauthorized", 401);
  const { searchParams } = new URL(req.url);
  const batchId = searchParams.get("batchId");
  const examDate = searchParams.get("examDate");
  const uploadDate = searchParams.get("uploadDate");
  const id = searchParams.get("id");
  if (!batchId && !examDate && !uploadDate && !id) {
    return ctx.fail("bad_request", 400, { message: "specify batchId, examDate, uploadDate, or id" });
  }
  try {
    const rows = await withTenant(userId, async ({ sql }) => {
    if (batchId) {
      return await sql`DELETE FROM exams WHERE user_id = ${userId} AND batch_id = ${batchId} RETURNING id`;
    } else if (examDate) {
      return await sql`DELETE FROM exams WHERE user_id = ${userId} AND exam_date::date = ${examDate}::date RETURNING id`;
    } else if (uploadDate) {
      return await sql`DELETE FROM exams WHERE user_id = ${userId} AND uploaded_at::date = ${uploadDate}::date RETURNING id`;
    }
      return await sql`DELETE FROM exams WHERE user_id = ${userId} AND id = ${id} RETURNING id`;
    });
    return Response.json({ ok: true, deleted: rows.length });
  } catch (err) {
    return ctx.fail("storage_unavailable", 503, { cause: err, message: "exam delete failed" });
  }
});
