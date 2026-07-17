// Per-user extra-duty pay rates (one current-value row per user).
//   GET  -> { rates: { perDiemRate, ppcMri, ppcCt, ppcXr } }  (zeros if unset)
//   POST { perDiemRate, ppcMri, ppcCt, ppcXr } -> upsert on user_id
// Scoped to the signed-in Clerk user id.

import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db, extraDutyRates } from "@/lib/db";

export const runtime = "nodejs";

const ZERO = { perDiemRate: 0, ppcMri: 0, ppcCt: 0, ppcXr: 0 };

export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "unauthorized", rates: ZERO }, { status: 401 });
  try {
    const rows = await db
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
  } catch (e) {
    return Response.json({ error: String(e), rates: ZERO }, { status: 200 });
  }
}

export async function POST(req) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const b = await req.json();
    const num = (v) => String(Math.max(0, Number(v) || 0));
    const values = {
      userId,
      perDiemRate: num(b.perDiemRate),
      ppcMri: num(b.ppcMri),
      ppcCt: num(b.ppcCt),
      ppcXr: num(b.ppcXr),
      updatedAt: new Date(),
    };
    await db
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
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
