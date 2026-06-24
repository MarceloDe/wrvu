// Per-user persistence backed by Neon Postgres (user_kv table).
// Keeps the exact get/set/delete contract the dashboard already uses, but every
// read/write is scoped to the signed-in Clerk user id — so each user has a fully
// isolated "instance" of their timeline / baseline / settings.

import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { db, userKv } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "unauthorized", value: null }, { status: 401 });
  const key = new URL(req.url).searchParams.get("key");
  if (!key) return Response.json({ error: "key required" }, { status: 400 });
  try {
    const rows = await db
      .select({ value: userKv.value })
      .from(userKv)
      .where(and(eq(userKv.userId, userId), eq(userKv.key, key)))
      .limit(1);
    return Response.json({ key, value: rows[0]?.value ?? null });
  } catch (e) {
    return Response.json({ error: String(e), value: null }, { status: 200 });
  }
}

export async function POST(req) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const { key, value } = await req.json();
    if (!key) return Response.json({ error: "key required" }, { status: 400 });
    await db
      .insert(userKv)
      .values({ userId, key, value })
      .onConflictDoUpdate({
        target: [userKv.userId, userKv.key],
        set: { value, updatedAt: new Date() },
      });
    return Response.json({ key, ok: true });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(req) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const key = new URL(req.url).searchParams.get("key");
  if (!key) return Response.json({ error: "key required" }, { status: 400 });
  try {
    await db.delete(userKv).where(and(eq(userKv.userId, userId), eq(userKv.key, key)));
    return Response.json({ key, deleted: true });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
