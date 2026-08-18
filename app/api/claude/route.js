// Server-side proxy to the Anthropic Messages API.
// The API key lives ONLY here (as an env var) and is never sent to the browser.
// Passing `tools` straight through preserves web search; base64 images preserve vision.
// Auth: only signed-in users may call this (prevents the key being used as an open relay).
//
// Anthropic's own error text is written to the server log (with the correlation
// id) and NEVER forwarded to the browser. Instead it is classified once, here,
// into a generic code — which is exactly what ocrErrorMessage() on the client
// turns into the HEIC / oversize / rate-limit / overloaded / timeout guidance.

import { auth } from "@clerk/nextjs/server";
import { withErrorEnvelope } from "@/lib/http/errors";

export const runtime = "nodejs";
export const maxDuration = 60; // vision + web search can take a while; Pro plan recommended

// Map an upstream failure to one of OUR codes. The vendor's words stop here.
function upstreamCode(status, detail) {
  const d = String(detail || "").toLowerCase();
  if (status === 429) return "upstream_rate_limited";
  if (status === 529 || d.includes("overloaded")) return "upstream_overloaded";
  if (status === 413 || d.includes("too large") || d.includes("exceeds") || d.includes("image dimensions")) {
    return "upstream_payload_too_large";
  }
  if (status === 408 || status === 504 || d.includes("timeout") || d.includes("timed out")) {
    return "upstream_timeout";
  }
  if (d.includes("media type") || d.includes("could not process image") || d.includes("invalid_request")) {
    return "upstream_invalid_image";
  }
  if (status >= 500) return "upstream_unavailable";
  return "upstream_rejected";
}

export const POST = withErrorEnvelope("/api/claude", async (req, ctx) => {
  const { userId } = await auth();
  if (!userId) return ctx.fail("unauthorized", 401);

  let payload;
  try {
    payload = await req.json();
  } catch (err) {
    return ctx.fail("invalid_json", 400, { cause: err });
  }
  const { messages, system, tools, maxTokens } = payload || {};

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return ctx.fail("config_missing", 500, { message: "ANTHROPIC_API_KEY is not set" });
  }

  const body = {
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
    max_tokens: maxTokens || 4000,
    messages,
  };
  if (system) body.system = system;
  if (tools) body.tools = tools;

  let r;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
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
    const detail = data?.error?.message || data?.error || `HTTP ${r.status}`;
    const imgCount = Array.isArray(messages)
      ? messages.reduce((n, m) => n + ((Array.isArray(m?.content) ? m.content : []).filter((b) => b?.type === "image").length), 0)
      : 0;
    const status = r.status >= 400 && r.status <= 599 ? r.status : 502;
    return ctx.fail(upstreamCode(r.status, detail), status, {
      message: `anthropic ${r.status} (${imgCount} image${imgCount === 1 ? "" : "s"}): ${typeof detail === "string" ? detail : JSON.stringify(detail)}`,
    });
  }
  return Response.json(data, { status: r.status });
});
