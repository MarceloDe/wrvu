// The edge API's meter endpoint.
//
// neurorvu-edge-api holds its own ANTHROPIC_API_KEY and serves /api/v1/resolve.
// It owns NO user rows (D29), so it cannot hold a per-user budget — it reports
// its token counts here instead, forwarding the end user's Clerk session token
// as `Authorization: Bearer …`. Clerk verifies it exactly as it does for a
// browser call, so the identity is never taken from the request body.
//
// The result: both LLM paths debit ONE per-user daily budget.
//
//   GET  -> { allowed, remaining }          pre-flight before an escalation
//   POST -> { allowed, remaining, usageId } after a completed escalation
//
// No prompt, completion or patient content is accepted or stored — counts only.

import { auth } from "@clerk/nextjs/server";
import { withErrorEnvelope } from "@/lib/http/errors";
import { checkCap, recordUsage, consumeRateToken } from "@/lib/usage/meter";

export const runtime = "nodejs";

// Sources permitted to bill against a user's budget through this route.
const ALLOWED_SOURCES = ["edge-api:resolve"];
const MAX_TOKENS_PER_REPORT = 1_000_000;

export const GET = withErrorEnvelope("/api/internal/usage", async (req, ctx) => {
  const { userId } = await auth();
  if (!userId) return ctx.fail("unauthorized", 401);
  let cap;
  try {
    cap = await checkCap(userId);
  } catch (err) {
    return ctx.fail("storage_unavailable", 500, { cause: err, message: "cap check failed" });
  }
  return Response.json({ allowed: cap.allowed, remaining: cap.remaining });
});

export const POST = withErrorEnvelope("/api/internal/usage", async (req, ctx) => {
  const { userId } = await auth();
  if (!userId) return ctx.fail("unauthorized", 401);

  let body;
  try {
    body = await req.json();
  } catch (err) {
    return ctx.fail("invalid_json", 400, { cause: err });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return ctx.fail("validation_failed", 400, { message: "body is not an object" });
  }
  for (const key of Object.keys(body)) {
    if (!["source", "inputTokens", "outputTokens"].includes(key)) {
      return ctx.fail("validation_failed", 400, { message: `unknown field ${key}` });
    }
  }
  // Identity is never taken from the body — only the source label is.
  if (!ALLOWED_SOURCES.includes(body.source)) {
    return ctx.fail("validation_failed", 400, { message: "unknown source label" });
  }
  const inputTokens = Number(body.inputTokens);
  const outputTokens = Number(body.outputTokens);
  for (const n of [inputTokens, outputTokens]) {
    if (!Number.isFinite(n) || n < 0 || n > MAX_TOKENS_PER_REPORT) {
      return ctx.fail("validation_failed", 400, { message: "token count out of range" });
    }
  }

  // Same meter, same order, same limits as /api/claude.
  const rate = await consumeRateToken(userId);
  if (!rate.allowed) {
    return ctx.fail("rate_limited", 429, {
      message: `per-user token bucket empty; retry in ${rate.retryAfterSeconds}s`,
    });
  }
  const before = await checkCap(userId);
  if (!before.allowed) {
    return ctx.fail("daily_cap_reached", 429, { message: `daily cap $${before.dailyCapUsd} exhausted` });
  }

  let written;
  try {
    written = await recordUsage(userId, body.source, inputTokens, outputTokens);
  } catch (err) {
    return ctx.fail("storage_unavailable", 500, { cause: err, message: "usage row write failed" });
  }

  const after = await checkCap(userId);
  return Response.json({ allowed: after.allowed, remaining: after.remaining, usageId: written.id });
});
