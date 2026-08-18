// Per-user persistence backed by Neon Postgres (user_kv table).
// Keeps the exact get/set/delete contract the dashboard already uses, but every
// read/write is scoped to the signed-in Clerk user id — so each user has a fully
// isolated "instance" of their timeline / baseline / settings.
//
// Failures never return 200 and never return driver text: a write that did not
// land answers non-2xx with { error: { code, correlationId } } so the client can
// tell "saved" from "lost" (INV-NO-RAW-ERRORS, INV-NO-SWALLOW).

import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { getDb, userKv } from "@/lib/db";
import { withErrorEnvelope } from "@/lib/http/errors";

export const runtime = "nodejs";

export const GET = withErrorEnvelope("/api/store", async (req, ctx) => {
  const { userId } = await auth();
  if (!userId) return ctx.fail("unauthorized", 401);
  const key = new URL(req.url).searchParams.get("key");
  if (!key) return ctx.fail("bad_request", 400, { message: "key query param required" });
  try {
    const rows = await getDb()
      .select({ value: userKv.value })
      .from(userKv)
      .where(and(eq(userKv.userId, userId), eq(userKv.key, key)))
      .limit(1);
    return Response.json({ key, value: rows[0]?.value ?? null });
  } catch (err) {
    return ctx.fail("storage_unavailable", 503, { cause: err, message: `read failed for key ${key}` });
  }
});

export const POST = withErrorEnvelope("/api/store", async (req, ctx) => {
  const { userId } = await auth();
  if (!userId) return ctx.fail("unauthorized", 401);
  let body;
  try {
    body = await req.json();
  } catch (err) {
    return ctx.fail("invalid_json", 400, { cause: err });
  }
  const { key, value } = body || {};
  if (!key) return ctx.fail("bad_request", 400, { message: "key required" });
  try {
    await getDb()
      .insert(userKv)
      .values({ userId, key, value })
      .onConflictDoUpdate({
        target: [userKv.userId, userKv.key],
        set: { value, updatedAt: new Date() },
      });
    return Response.json({ key, ok: true });
  } catch (err) {
    return ctx.fail("storage_unavailable", 503, { cause: err, message: `write failed for key ${key}` });
  }
});

export const DELETE = withErrorEnvelope("/api/store", async (req, ctx) => {
  const { userId } = await auth();
  if (!userId) return ctx.fail("unauthorized", 401);
  const key = new URL(req.url).searchParams.get("key");
  if (!key) return ctx.fail("bad_request", 400, { message: "key query param required" });
  try {
    await getDb().delete(userKv).where(and(eq(userKv.userId, userId), eq(userKv.key, key)));
    return Response.json({ key, deleted: true });
  } catch (err) {
    return ctx.fail("storage_unavailable", 503, { cause: err, message: `delete failed for key ${key}` });
  }
});
