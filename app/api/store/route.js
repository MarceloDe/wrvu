// Persistent key-value store backed by Upstash Redis (Vercel Marketplace).
// Replaces the artifact's window.storage with the same get/set/delete shape.
//
// When you add the "Upstash for Redis" integration in the Vercel dashboard and
// connect it to this project, it injects KV_REST_API_URL and KV_REST_API_TOKEN.
// Redis.fromEnv() reads those automatically.
//
// MULTI-USER: replace USER with the signed-in user id (NextAuth/Clerk) to scope
// keys per user, e.g. `neurorvu:<userId>:<key>`.

import { Redis } from "@upstash/redis";

export const runtime = "nodejs";

const redis = Redis.fromEnv();
const USER = "me"; // swap for a real user id once you add auth
const NS = (k) => `neurorvu:${USER}:${k}`;

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const key = searchParams.get("key");
    if (!key) return Response.json({ error: "key required" }, { status: 400 });
    const value = await redis.get(NS(key)); // returns parsed JSON or null
    return Response.json({ key, value: value ?? null });
  } catch (e) {
    return Response.json({ error: String(e), value: null }, { status: 200 });
  }
}

export async function POST(req) {
  try {
    const { key, value } = await req.json();
    if (!key) return Response.json({ error: "key required" }, { status: 400 });
    await redis.set(NS(key), value); // stores JSON natively
    return Response.json({ key, ok: true });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const { searchParams } = new URL(req.url);
    const key = searchParams.get("key");
    if (!key) return Response.json({ error: "key required" }, { status: 400 });
    await redis.del(NS(key));
    return Response.json({ key, deleted: true });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
