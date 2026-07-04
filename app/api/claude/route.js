// Server-side proxy to the Anthropic Messages API.
// The API key lives ONLY here (as an env var) and is never sent to the browser.
// Passing `tools` straight through preserves web search; base64 images preserve vision.
// Auth: only signed-in users may call this (prevents the key being used as an open relay).

import { auth } from "@clerk/nextjs/server";

export const runtime = "nodejs";
export const maxDuration = 60; // vision + web search can take a while; Pro plan recommended

export async function POST(req) {
  try {
    const { userId } = await auth();
    if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

    const { messages, system, tools, maxTokens } = await req.json();
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
      return Response.json({ error: "Missing ANTHROPIC_API_KEY env var" }, { status: 500 });
    }

    const body = {
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
      max_tokens: maxTokens || 4000,
      messages,
    };
    if (system) body.system = system;
    if (tools) body.tools = tools;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    const data = await r.json();
    if (!r.ok) {
      // Surface Anthropic's own error (bad image format, payload too large, rate
      // limit, overloaded, …) in the server logs so silent OCR failures are
      // diagnosable, and pass the human-readable message back to the client.
      const detail = data?.error?.message || data?.error || `HTTP ${r.status}`;
      const imgCount = Array.isArray(messages)
        ? messages.reduce((n, m) => n + ((Array.isArray(m?.content) ? m.content : []).filter(b => b?.type === "image").length), 0)
        : 0;
      console.error(`[claude] Anthropic ${r.status} (${imgCount} image${imgCount === 1 ? "" : "s"}):`, detail);
      return Response.json({ error: detail, status: r.status }, { status: r.status });
    }
    return Response.json(data, { status: r.status });
  } catch (e) {
    console.error("[claude] proxy error:", e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
