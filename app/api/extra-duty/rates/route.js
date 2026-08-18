// Per-user extra-duty pay rates (one current-value row per user).
//   GET  -> { rates: { perDiemRate, ppcMri, ppcCt, ppcXr } }  (zeros if unset)
//   POST { perDiemRate, ppcMri, ppcCt, ppcXr } -> upsert on user_id
// Scoped to the signed-in Clerk user id.
//
// A read or write that fails answers non-2xx with the generic envelope. It must
// never answer 200 with zeroed rates — that would silently re-price a shift.

import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { getDb, extraDutyRates } from "@/lib/db";
import { withErrorEnvelope } from "@/lib/http/errors";

export const runtime = "nodejs";

const ZERO = { perDiemRate: 0, ppcMri: 0, ppcCt: 0, ppcXr: 0 };

export const GET = withErrorEnvelope("/api/extra-duty/rates", async (req, ctx) => {
  const { userId } = await auth();
  if (!userId) return ctx.fail("unauthorized", 401);
  try {
    const rows = await getDb()
      .select()
      .from(extraDutyRates)
      .where(eq(extraDutyRates.userId, userId))
      .limit(1);
    const r = rows[0];
    const rates = r
      ? {
          perDiemRate: Number(r.perDiemRate) || 0,
          ppcMri: Number(r.ppcMri) || 0,
          ppcCt: Number(r.ppcCt) || 0,
          ppcXr: Number(r.ppcXr) || 0,
        }
      : ZERO;
    return Response.json({ rates });
  } catch (err) {
    return ctx.fail("storage_unavailable", 503, { cause: err, message: "rates read failed" });
  }
});

export const POST = withErrorEnvelope("/api/extra-duty/rates", async (req, ctx) => {
  const { userId } = await auth();
  if (!userId) return ctx.fail("unauthorized", 401);
  let b;
  try {
    b = await req.json();
  } catch (err) {
    return ctx.fail("invalid_json", 400, { cause: err });
  }
  const num = (v) => String(Math.max(0, Number(v) || 0));
  const values = {
    userId,
    perDiemRate: num(b?.perDiemRate),
    ppcMri: num(b?.ppcMri),
    ppcCt: num(b?.ppcCt),
    ppcXr: num(b?.ppcXr),
    updatedAt: new Date(),
  };
  try {
    await getDb()
      .insert(extraDutyRates)
      .values(values)
      .onConflictDoUpdate({
        target: extraDutyRates.userId,
        set: {
          perDiemRate: values.perDiemRate,
          ppcMri: values.ppcMri,
          ppcCt: values.ppcCt,
          ppcXr: values.ppcXr,
          updatedAt: values.updatedAt,
        },
      });
    return Response.json({ ok: true });
  } catch (err) {
    return ctx.fail("storage_unavailable", 503, { cause: err, message: "rates write failed" });
  }
});
