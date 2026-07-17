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
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";

const sql = neon(process.env.DATABASE_URL || process.env.POSTGRES_URL);

export async function GET(req) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  let periods;
  if (from && to) {
    periods = await sql`
      SELECT id, bundle_date AS "bundleDate", pay_model AS "payModel",
             exam_count AS "examCount", count_mri AS "countMri", count_ct AS "countCt",
             count_xr AS "countXr", count_other AS "countOther", amount::float AS amount,
             rate_snapshot AS "rateSnapshot", label, batch_id AS "batchId", source,
             created_at AS "createdAt"
      FROM extra_duty_periods
      WHERE user_id = ${userId}
        AND bundle_date::date >= ${from}::date AND bundle_date::date <= ${to}::date
      ORDER BY bundle_date DESC`;
  } else {
    periods = await sql`
      SELECT id, bundle_date AS "bundleDate", pay_model AS "payModel",
             exam_count AS "examCount", count_mri AS "countMri", count_ct AS "countCt",
             count_xr AS "countXr", count_other AS "countOther", amount::float AS amount,
             rate_snapshot AS "rateSnapshot", label, batch_id AS "batchId", source,
             created_at AS "createdAt"
      FROM extra_duty_periods
      WHERE user_id = ${userId}
      ORDER BY bundle_date DESC`;
  }
  return Response.json({ periods });
}

export async function POST(req) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  let b;
  try { b = await req.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }

  const payModel = b.payModel === "ppc" ? "ppc" : "per_diem";
  if (!b.bundleDate) return Response.json({ error: "bundleDate required" }, { status: 400 });
  const int = (v) => Math.max(0, Math.round(Number(v) || 0));

  try {
    const [row] = await sql`
      INSERT INTO extra_duty_periods
        (user_id, bundle_date, pay_model, exam_count, count_mri, count_ct, count_xr,
         count_other, amount, rate_snapshot, label, batch_id, source)
      VALUES
        (${userId}, ${b.bundleDate}, ${payModel}, ${int(b.examCount)}, ${int(b.countMri)},
         ${int(b.countCt)}, ${int(b.countXr)}, ${int(b.countOther)}, ${String(Number(b.amount) || 0)},
         ${b.rateSnapshot ? JSON.stringify(b.rateSnapshot) : null}, ${b.label || null},
         ${b.batchId || null}, ${b.source === "screenshot" ? "screenshot" : "manual"})
      RETURNING id`;
    return Response.json({ ok: true, id: row.id });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(req) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  try {
    const rows = await sql`DELETE FROM extra_duty_periods WHERE user_id = ${userId} AND id = ${id} RETURNING id`;
    return Response.json({ ok: true, deleted: rows.length });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
