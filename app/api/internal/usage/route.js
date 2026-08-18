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
//   GET  -> { allowed, remaining }         pre-flight before an escalation
//   POST -> { allowed, remaining, usageId } after a completed escalation
//
// No prompt, completion or patient content is accepted or stored — counts only.

import { auth } from "@clerk/nextjs/server";
import { checkCap, recordUsage, consumeRateToken } from "@/lib/usage/meter";

export const runtime = "nodejs";

// Sources permitted to bill against a user's budget through this route.
const ALLOWED_SOURCES = ["edge-api:resolve"];
const MAX_TOKENS_PER_REPORT = 1_000_000;

function envelope(status, code, correlationId, extra = {}) {
  return Response.json({ error: code, code, correlationId, ...extra }, { status });
}

export async function GET() {
  const correlationId = crypto.randomUUID();
  try {
    const { userId } = await auth();
    if (!userId) return envelope(401, "unauthorized", correlationId);
    const cap = await checkCap(userId);
    return Response.json({ allowed: cap.allowed, remaining: cap.remaining, correlationId });
  } catch (e) {
    console.error(`[internal-usage] ${correlationId} cap check failed:`, e);
    return envelope(500, "internal_error", correlationId);
  }
}

export async function POST(req) {
  const correlationId = crypto.randomUUID();
  try {
    const { userId } = await auth();
    if (!userId) return envelope(401, "unauthorized", correlationId);

    let body;
    try {
      body = await req.json();
    } catch {
      return envelope(400, "invalid_json", correlationId);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return envelope(400, "invalid_body", correlationId);
    }
    for (const key of Object.keys(body)) {
      if (!["source", "inputTokens", "outputTokens"].includes(key)) {
        return envelope(400, "unknown_field", correlationId);
      }
    }
    // Identity is never taken from the body — only the source label is.
    if (!ALLOWED_SOURCES.includes(body.source)) {
      return envelope(400, "unknown_source", correlationId);
    }
    const inputTokens = Number(body.inputTokens);
    const outputTokens = Number(body.outputTokens);
    for (const n of [inputTokens, outputTokens]) {
      if (!Number.isFinite(n) || n < 0 || n > MAX_TOKENS_PER_REPORT) {
        return envelope(400, "invalid_tokens", correlationId);
      }
    }

    // Same meter, same order, same limits as /api/claude.
    const rate = await consumeRateToken(userId);
    if (!rate.allowed) {
      return envelope(429, "rate_limited", correlationId, { retryAfterSeconds: rate.retryAfterSeconds });
    }
    const before = await checkCap(userId);
    if (!before.allowed) {
      return envelope(429, "daily_cap_reached", correlationId, { remaining: 0 });
    }

    let written;
    try {
      written = await recordUsage(userId, body.source, inputTokens, outputTokens);
    } catch (e) {
      console.error(`[internal-usage] ${correlationId} usage write failed:`, e);
      return envelope(500, "usage_write_failed", correlationId);
    }

    const after = await checkCap(userId);
    return Response.json({
      allowed: after.allowed,
      remaining: after.remaining,
      usageId: written.id,
      correlationId,
    });
  } catch (e) {
    console.error(`[internal-usage] ${correlationId} error:`, e);
    return envelope(500, "internal_error", correlationId);
  }
}
