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
import { resolveMany } from "@/lib/pricing/resolve-value";
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
             institution, modality, wrvu::float AS wrvu, estimated, source, uploaded_at AS "uploadedAt",
             wrvu_state AS "wrvuState"
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
  // INV-MONEY-ONE-PATH: the wRVU is resolved HERE, from the CMS reference schema. Any
  // value the client sent is read and discarded — the two clients disagreed on 54 of 61
  // codes precisely because each priced locally, and no amount of unifying the table
  // fixes that while the number still arrives from the device.
  let priced;
  try {
    priced = await resolveMany(exams.map((e) => ({ hcpcs: e.cpt || "" })));
  } catch (err) {
    return ctx.fail("pricing_unavailable", 503, { cause: err, message: "could not reach the reference schema" });
  }

  try {
    // Already inside ONE transaction via withTenant, so the batch is still atomic —
    // sql.transaction() is gone because nesting would discard the SET LOCAL.
    await withTenant(userId, async ({ sql }) => {
      // Resolve the institution link once for the batch. A user who has never opened
      // Settings has no rows yet, and that is fine: institution_id stays null and the
      // text column still carries the site, exactly as it did before N18.
      const rows = await sql`select id, name from institutions`;
      const instIdByName = Object.fromEntries(rows.map((r) => [r.name, r.id]));
      const fallbackId = instIdByName.Other ?? null;
      for (let i = 0; i < exams.length; i++) {
        const e = exams[i];
        const v = priced[i];
        // 0 for an unpriced code, but never a 0 that pretends to be a price: wrvu_state
        // records why. wrvu stays NOT NULL because the dashboard sums it with bare +=,
        // and a NULL there becomes NaN and poisons every total silently.
        const wrvu = v.workRvu === null ? 0 : v.workRvu;
        // Modality comes from CMS too, for the same reason the price does: the client
        // used to default an unrecognised study to "CT", which is a PAID PPC bucket.
        // Falling back to whatever the client said is fine — what is not fine is
        // inventing "CT" when nobody knows.
        await sql`
          INSERT INTO exams (user_id, batch_id, exam_date, cpt, procedure, site, institution, modality, wrvu, estimated, source, wrvu_state, priced_from, institution_id)
          VALUES (${userId}, ${batchId}, ${e.examDate || null}, ${e.cpt || null}, ${e.procedure || null},
                  ${e.site || null}, ${e.institution || null}, ${v.modality ?? e.modality ?? null},
                  ${String(wrvu)}, ${!!e.estimated}, ${source}, ${v.state}, ${v.versionId},
                  ${instIdByName[e.institution] ?? fallbackId})`;
      }
    });
    return Response.json({
      ok: true, inserted: exams.length, batchId,
      // Surfaced so a client can tell the user which studies could not be priced,
      // instead of quietly showing them as zero.
      unpriced: priced.map((v, i) => (v.workRvu === null ? { cpt: exams[i].cpt ?? null, state: v.state } : null)).filter(Boolean),
    });
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
