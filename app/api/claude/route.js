// Server-side proxy to the Anthropic Messages API.
//
// This route used to forward a client-supplied prompt, tool set and token
// budget verbatim. It no longer does. The client names a TEMPLATE ID; the
// system prompt, the tool set (always empty) and the token ceiling are resolved
// from lib/prompts/registry.js and from nowhere else. A request that carries
// system, tools or maxTokens is a 400 and never reaches the vendor
// (INV-SERVER-PROMPTS).
//
// Every accepted call passes a persisted per-user token bucket and a per-user
// daily spend cap, and writes a usage row. The edge API's own model calls report
// into the same meter via /api/internal/usage, so one user has one budget across
// both services.
//
// Errors go out through the ONE envelope (lib/http/errors): a stable code plus a
// correlation id, with the vendor's own words written to the server log against
// the same id and never to the wire (INV-NO-RAW-ERRORS). The code vocabulary is
// the one ocrErrorMessage() in components/NeuroRVU.jsx already branches on.

import { auth } from "@clerk/nextjs/server";
import { withErrorEnvelope } from "@/lib/http/errors";
import { parseProxyRequest, buildAnthropicRequest } from "@/lib/prompts/registry";
import { consumeRateToken, checkCap, recordUsage } from "@/lib/usage/meter";

export const runtime = "nodejs";
export const maxDuration = 60; // vision on a multi-page report can take a while

// Map an upstream failure to one of OUR codes. The vendor's words stop here.
function upstreamCode(status, detail) {
  const d = String(detail || "").toLowerCase();
  if (status === 429) return "upstream_rate_limited";
  if (status === 529 || status === 503 || d.includes("overloaded")) return "upstream_overloaded";
  if (status === 413 || d.includes("too large") || d.includes("exceeds") || d.includes("image dimensions")) {
    return "upstream_payload_too_large";
  }
  if (status === 408 || status === 504 || d.includes("timeout") || d.includes("timed out")) {
    return "upstream_timeout";
  }
  if (status === 400 || d.includes("media type") || d.includes("could not process image") || d.includes("invalid_request")) {
    return "upstream_invalid_image";
  }
  if (status === 401 || status === 403) return "upstream_rejected";
  if (status >= 500) return "upstream_unavailable";
  return "upstream_rejected";
}

// The registry's rejection reasons, narrowed to the envelope's vocabulary.
// Anything not named here is a generic validation failure — a caller never
// needs a finer reason to fix its own request.
const REJECTION_CODES = {
  server_owned_field: "server_owned_field",
  unknown_template: "unknown_template",
  invalid_template: "unknown_template",
  unsupported_media_type: "unsupported_media_type",
  attachment_too_large: "attachment_too_large",
  too_many_attachments: "too_many_attachments",
};

export const POST = withErrorEnvelope("/api/claude", async (req, ctx) => {
  const { userId } = await auth();
  if (!userId) return ctx.fail("unauthorized", 401);

  let payload;
  try {
    payload = await req.json();
  } catch (err) {
    return ctx.fail("invalid_json", 400, { cause: err });
  }

  // --- Per-user rate limit (persisted token bucket). ---
  // Deliberately BEFORE validation: a stream of malformed requests is still a
  // stream of requests, and this ordering also makes the limiter probe-able
  // without spending a cent upstream.
  const rate = await consumeRateToken(userId);
  if (!rate.allowed) {
    return ctx.fail("rate_limited", 429, {
      message: `per-user token bucket empty; retry in ${rate.retryAfterSeconds}s`,
    });
  }

  // --- Contract gate. Runs before the vendor is contacted at all. ---
  const parsed = parseProxyRequest(payload);
  if (!parsed.ok) {
    return ctx.fail(REJECTION_CODES[parsed.code] || "validation_failed", parsed.status || 400, {
      message: `rejected: ${parsed.code}${parsed.detail ? ` (${parsed.detail})` : ""}`,
    });
  }
  const { template, attachments } = parsed;

  // --- Per-user daily spend cap, shared with the edge API's LLM path. ---
  const cap = await checkCap(userId);
  if (!cap.allowed) {
    return ctx.fail("daily_cap_reached", 429, {
      message: `daily cap $${cap.dailyCapUsd} exhausted (spent $${cap.spent})`,
    });
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return ctx.fail("config_missing", 500, { message: "ANTHROPIC_API_KEY is not set" });
  }

  const upstream = buildAnthropicRequest(template, attachments, process.env.ANTHROPIC_MODEL);

  let r;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(upstream),
    });
  } catch (err) {
    return ctx.fail("upstream_unavailable", 502, { cause: err, message: "anthropic request failed" });
  }

  let data;
  try {
    data = await r.json();
  } catch (err) {
    return ctx.fail("upstream_unavailable", 502, { cause: err, message: `anthropic sent a non-JSON ${r.status}` });
  }

  if (!r.ok) {
    // The vendor detail goes to the log only — the caller gets a generic code.
    const detail = data?.error?.message || data?.error?.type || `HTTP ${r.status}`;
    const status = r.status >= 400 && r.status <= 599 ? r.status : 502;
    return ctx.fail(upstreamCode(r.status, detail), status, {
      message: `template=${template.id} attachments=${attachments.length} anthropic ${r.status}: ${
        typeof detail === "string" ? detail : JSON.stringify(detail)
      }`,
    });
  }

  // --- Accounting. A call we cannot account for is not a success. ---
  const usage = data?.usage || {};
  const tokensIn =
    (usage.input_tokens || 0) +
    (usage.cache_creation_input_tokens || 0) +
    (usage.cache_read_input_tokens || 0);
  try {
    await recordUsage(userId, template.id, tokensIn, usage.output_tokens || 0);
  } catch (err) {
    return ctx.fail("storage_unavailable", 500, { cause: err, message: "usage row write failed" });
  }

  return Response.json(data);
});
