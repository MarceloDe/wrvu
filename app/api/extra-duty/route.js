// Extra-duty periods (paid separately from the monthly wRVU target/flow).
// One row = one tagged bundle/shift (per-diem or PPC). Aggregate only — extra
// duty is deliberately NOT written to the `exams` table, so the tracker/timeline
// wRVU totals are never affected.
//   GET                 -> all periods for the user (newest bundle_date first)
//   GET ?from=&to=      -> periods with bundle_date in [from, to] (YYYY-MM-DD)
//   POST { payModel, bundleDate, examCount, countMri, countCt, countXr,
//          countOther, amount, rateSnapshot, label, batchId, source }
//   DELETE ?id=         -> delete one period
// Every query is scoped to the signed-in Clerk user id.

import { auth } from "@clerk/nextjs/server";
import { withTenant } from "@/lib/db";
import { withErrorEnvelope } from "@/lib/http/errors";

export const runtime = "nodejs";

export const GET = withErrorEnvelope("/api/extra-duty", async (req, ctx) => {
  const { userId } = await auth();
  if (!userId) return ctx.fail("unauthorized", 401);
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  try {
    const periods = await withTenant(userId, async ({ sql }) => {
      if (from && to) {
        return await sql`
        SELECT id, bundle_date AS "bundleDate", pay_model AS "payModel",
               exam_count AS "examCount", count_mri AS "countMri", count_ct AS "countCt",
               count_xr AS "countXr", count_other AS "countOther", amount::float AS amount,
               rate_snapshot AS "rateSnapshot", label, batch_id AS "batchId", source,
               created_at AS "createdAt"
        FROM extra_duty_periods
        WHERE user_id = ${userId}
          AND bundle_date::date >= ${from}::date AND bundle_date::date <= ${to}::date
          ORDER BY bundle_date DESC`;
      }
      return await sql`
        SELECT id, bundle_date AS "bundleDate", pay_model AS "payModel",
               exam_count AS "examCount", count_mri AS "countMri", count_ct AS "countCt",
               count_xr AS "countXr", count_other AS "countOther", amount::float AS amount,
               rate_snapshot AS "rateSnapshot", label, batch_id AS "batchId", source,
               created_at AS "createdAt"
        FROM extra_duty_periods
        WHERE user_id = ${userId}
        ORDER BY bundle_date DESC`;
    });
    return Response.json({ periods });
  } catch (err) {
    return ctx.fail("storage_unavailable", 503, { cause: err, message: "periods read failed" });
  }
});

export const POST = withErrorEnvelope("/api/extra-duty", async (req, ctx) => {
  const { userId } = await auth();
  if (!userId) return ctx.fail("unauthorized", 401);
  let b;
  try {
    b = await req.json();
  } catch (err) {
    return ctx.fail("invalid_json", 400, { cause: err });
  }

  const payModel = b?.payModel === "ppc" ? "ppc" : "per_diem";
  if (!b?.bundleDate) return ctx.fail("validation_failed", 400, { message: "bundleDate required" });
  const int = (v) => Math.max(0, Math.round(Number(v) || 0));

  try {
    const [row] = await withTenant(userId, ({ sql }) => sql`
      INSERT INTO extra_duty_periods
        (user_id, bundle_date, pay_model, exam_count, count_mri, count_ct, count_xr,
         count_other, amount, rate_snapshot, label, batch_id, source)
      VALUES
        (${userId}, ${b.bundleDate}, ${payModel}, ${int(b.examCount)}, ${int(b.countMri)},
         ${int(b.countCt)}, ${int(b.countXr)}, ${int(b.countOther)}, ${String(Number(b.amount) || 0)},
         ${b.rateSnapshot ? JSON.stringify(b.rateSnapshot) : null}, ${b.label || null},
         ${b.batchId || null}, ${b.source === "screenshot" ? "screenshot" : "manual"})
      RETURNING id`);
    return Response.json({ ok: true, id: row.id });
  } catch (err) {
    return ctx.fail("storage_unavailable", 503, { cause: err, message: "period write failed" });
  }
});

export const DELETE = withErrorEnvelope("/api/extra-duty", async (req, ctx) => {
  const { userId } = await auth();
  if (!userId) return ctx.fail("unauthorized", 401);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return ctx.fail("bad_request", 400, { message: "id query param required" });
  try {
    const rows = await withTenant(userId, ({ sql }) =>
      sql`DELETE FROM extra_duty_periods WHERE user_id = ${userId} AND id = ${id} RETURNING id`);
    return Response.json({ ok: true, deleted: rows.length });
  } catch (err) {
    return ctx.fail("storage_unavailable", 503, { cause: err, message: `period delete failed for ${id}` });
  }
});
