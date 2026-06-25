// Token-gated endpoint to test the OCR extraction + validation prompt against
// images, using the server-side ANTHROPIC_API_KEY. Lets us verify the rule on
// real worklist screenshots (and refusal on non-worklists) without the UI.
//
//   curl -X POST /api/ocr-test -H "x-setup-token: $SETUP_TOKEN" \
//        -H "content-type: application/json" \
//        -d '{"media_type":"image/png","data":"<base64>"}'
//
// Body: { media_type, data }  OR  { images: [{media_type, data}, ...] }

import { extractionSystemPrompt, extractionUserText } from "@/lib/ocr-prompt";

export const runtime = "nodejs";
export const maxDuration = 60;

function parseJSON(raw) {
  const clean = String(raw).replace(/```json/gi, "").replace(/```/g, "").trim();
  const so = clean.indexOf("{"), eo = clean.lastIndexOf("}");
  const slice = so !== -1 && eo !== -1 ? clean.slice(so, eo + 1) : clean;
  return JSON.parse(slice);
}

export async function POST(req) {
  const token = req.headers.get("x-setup-token");
  if (!process.env.SETUP_TOKEN || token !== process.env.SETUP_TOKEN) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return Response.json({ error: "no ANTHROPIC_API_KEY" }, { status: 500 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }
  const imgs = (body.images || [body]).filter((i) => i && i.data).map((i) => ({
    type: "image",
    source: { type: "base64", media_type: i.media_type || "image/png", data: i.data },
  }));
  if (!imgs.length) return Response.json({ error: "no image" }, { status: 400 });

  const payload = {
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
    max_tokens: 8000,
    system: extractionSystemPrompt(),
    messages: [{ role: "user", content: [...imgs, { type: "text", text: extractionUserText }] }],
  };

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(payload),
  });
  const data = await r.json();
  if (!r.ok) return Response.json({ error: "anthropic", detail: data }, { status: r.status });

  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  let parsed = null, parseError = null;
  try { parsed = parseJSON(text); } catch (e) { parseError = String(e); }

  // Compact summary so the response is easy to eyeball.
  const summary = parsed?.valid === true
    ? { valid: true, examCount: parsed.exams?.length ?? 0, sample: (parsed.exams || []).slice(0, 3),
        dates: [...new Set((parsed.exams || []).map((e) => String(e.exam_date).slice(0, 10)))].sort() }
    : parsed?.valid === false
    ? { valid: false, reason: parsed.reason }
    : { valid: null, parseError, rawHead: text.slice(0, 300) };

  return Response.json({ summary, parsed });
}
