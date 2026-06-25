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
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";

const sql = neon(process.env.DATABASE_URL || process.env.POSTGRES_URL);

export async function GET(req) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);

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
}

export async function POST(req) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }
  const { batchId, source = "screenshot", exams = [] } = body;
  if (!batchId || !Array.isArray(exams) || !exams.length) {
    return Response.json({ error: "batchId and non-empty exams[] required" }, { status: 400 });
  }
  try {
    const queries = exams.map((e) => sql`
      INSERT INTO exams (user_id, batch_id, exam_date, cpt, procedure, site, institution, modality, wrvu, estimated, source)
      VALUES (${userId}, ${batchId}, ${e.examDate || null}, ${e.cpt || null}, ${e.procedure || null},
              ${e.site || null}, ${e.institution || null}, ${e.modality || null},
              ${String(e.wrvu ?? 0)}, ${!!e.estimated}, ${source})`);
    await sql.transaction(queries);
    return Response.json({ ok: true, inserted: exams.length, batchId });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(req) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const batchId = searchParams.get("batchId");
  const examDate = searchParams.get("examDate");
  const uploadDate = searchParams.get("uploadDate");
  const id = searchParams.get("id");
  try {
    let rows;
    if (batchId) {
      rows = await sql`DELETE FROM exams WHERE user_id = ${userId} AND batch_id = ${batchId} RETURNING id`;
    } else if (examDate) {
      rows = await sql`DELETE FROM exams WHERE user_id = ${userId} AND exam_date::date = ${examDate}::date RETURNING id`;
    } else if (uploadDate) {
      rows = await sql`DELETE FROM exams WHERE user_id = ${userId} AND uploaded_at::date = ${uploadDate}::date RETURNING id`;
    } else if (id) {
      rows = await sql`DELETE FROM exams WHERE user_id = ${userId} AND id = ${id} RETURNING id`;
    } else {
      return Response.json({ error: "specify batchId, examDate, uploadDate, or id" }, { status: 400 });
    }
    return Response.json({ ok: true, deleted: rows.length });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
