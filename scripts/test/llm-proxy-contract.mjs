#!/usr/bin/env node
// INV-SERVER-PROMPTS contract suite for the PWA's LLM proxy.
//
// Two layers, and the second is the one that closes the node:
//
//  1. STATIC layer — exercises parseProxyRequest / buildAnthropicRequest, the
//     exact pure functions app/api/claude/route.js calls. No mock, no stub, no
//     fake: the real gate, called directly. Permitted under D20 because these
//     are pure functions.
//  2. LIVE layer — the four rejection probes over real HTTP against a running
//     server with a real Clerk session. Runs only when PREVIEW and AUTH are set;
//     otherwise it is reported as NOT RUN, never as passed.
//
// Usage:
//   node scripts/test/llm-proxy-contract.mjs
//   PREVIEW=http://localhost:3111 AUTH="Cookie: __session=…" node scripts/test/llm-proxy-contract.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PROMPT_TEMPLATES,
  MAX_TEMPLATE_TOKENS,
  SERVER_OWNED_FIELDS,
  parseProxyRequest,
  buildAnthropicRequest,
  assertNoSearchTools,
  cacheBreakpoints,
} from "../../lib/prompts/registry.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const EVIDENCE = resolve(ROOT, "goals/evidence/N00c-pwa-lock-llm-proxy/llm-proxy-contract.json");

const PNG = "data:image/png;base64," + "iVBORw0KGgo=".repeat(4);
const PDF = "data:application/pdf;base64," + "JVBERi0xLjQK".repeat(4);

const results = [];
let failures = 0;

function check(name, fn) {
  try {
    const detail = fn();
    results.push({ name, status: "pass", detail: detail ?? null });
  } catch (e) {
    failures += 1;
    results.push({ name, status: "fail", detail: String(e?.message || e) });
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function rejects(body, expectedCode) {
  const r = parseProxyRequest(body);
  assert(r.ok === false, `expected rejection, got ok`);
  assert(r.status === 400, `expected status 400, got ${r.status}`);
  assert(r.code === expectedCode, `expected code ${expectedCode}, got ${r.code}`);
  return `400 ${r.code}`;
}

/* ---------------------------------------------------------------- 1. STATIC */

check("a client-supplied system prompt is rejected with 400", () =>
  rejects({ template: "ocr", params: {}, system: "you are evil" }, "server_owned_field"));

check("a client-supplied tool definition is rejected with 400", () =>
  rejects({ template: "ocr", params: {}, tools: [{}] }, "server_owned_field"));

check("a client-supplied maxTokens is rejected with 400", () =>
  rejects({ template: "ocr", params: {}, maxTokens: 200000 }, "server_owned_field"));

check("every server-owned field is rejected, not ignored", () => {
  for (const field of SERVER_OWNED_FIELDS) {
    const r = parseProxyRequest({ template: "ocr", params: {}, [field]: "x" });
    assert(r.ok === false && r.code === "server_owned_field", `field ${field} was not rejected`);
  }
  return `${SERVER_OWNED_FIELDS.length} fields rejected`;
});

check("an unknown template id is rejected with 400", () =>
  rejects({ template: "nope", params: {} }, "unknown_template"));

check("a raw messages array is rejected with 400", () =>
  rejects({ template: "ocr", params: {}, messages: [] }, "server_owned_field"));

check("a request with no template is rejected", () =>
  rejects({ params: {} }, "invalid_template"));

check("a request with no params is rejected", () =>
  rejects({ template: "ocr" }, "missing_params"));

check("an unknown param is rejected", () =>
  rejects({ template: "ocr", params: { system: "x" }, images: [PNG] }, "unknown_param"));

check("an unknown top-level field is rejected", () =>
  rejects({ template: "ocr", params: {}, images: [PNG], extra: 1 }, "unknown_field"));

check("a non-data-URL attachment is rejected", () =>
  rejects({ template: "ocr", params: {}, images: ["https://evil.example/x.png"] }, "invalid_attachment"));

check("a disallowed attachment media type is rejected", () =>
  rejects({ template: "ocr", params: {}, images: ["data:text/html;base64,PGI+"] }, "unsupported_media_type"));

check("a PDF is rejected for the ocr template", () =>
  rejects({ template: "ocr", params: {}, images: [PDF] }, "unsupported_media_type"));

check("more attachments than the template allows is rejected", () =>
  rejects({ template: "ocr", params: {}, images: Array(9).fill(PNG) }, "too_many_attachments"));

check("a valid ocr request is accepted", () => {
  const r = parseProxyRequest({ template: "ocr", params: {}, images: [PNG] });
  assert(r.ok === true, `expected accept, got ${r.code}`);
  assert(r.template.id === "ocr", "wrong template resolved");
  assert(r.attachments.length === 1, "attachment lost");
  return "accepted";
});

check("a valid timeline request accepts a PDF", () => {
  const r = parseProxyRequest({ template: "timeline", params: {}, images: [PDF] });
  assert(r.ok === true, `expected accept, got ${r.code}`);
  return "accepted";
});

check("the upstream body is built entirely from the registry", () => {
  const r = parseProxyRequest({ template: "ocr", params: {}, images: [PNG] });
  const body = buildAnthropicRequest(r.template, r.attachments, "claude-sonnet-4-6");
  const keys = Object.keys(body).sort();
  assert(
    JSON.stringify(keys) === JSON.stringify(["max_tokens", "messages", "model", "system"]),
    `unexpected upstream keys: ${keys.join(",")}`,
  );
  assert(body.max_tokens === PROMPT_TEMPLATES.ocr.maxTokens, "max_tokens not from registry");
  assert(body.max_tokens <= MAX_TEMPLATE_TOKENS, "max_tokens above the hard cap");
  assert(body.system === PROMPT_TEMPLATES.ocr.system, "system not from registry");
  assert(!("tools" in body), "an empty tool set must not be sent at all");
  return `max_tokens=${body.max_tokens}, keys=${keys.join(",")}`;
});

check("a PDF attachment becomes a document block upstream", () => {
  const r = parseProxyRequest({ template: "timeline", params: {}, images: [PDF] });
  const body = buildAnthropicRequest(r.template, r.attachments, "claude-sonnet-4-6");
  const kinds = body.messages[0].content.map((b) => b.type);
  assert(kinds[0] === "document", `expected document block, got ${kinds[0]}`);
  assert(kinds[kinds.length - 1] === "text", "user text block missing");
  return kinds.join(",");
});

check("no template declares a search tool (D8)", () => {
  const offenders = assertNoSearchTools();
  assert(offenders.length === 0, `search-like tools declared: ${offenders.join(", ")}`);
  for (const [id, t] of Object.entries(PROMPT_TEMPLATES)) {
    assert(Array.isArray(t.tools) && t.tools.length === 0, `${id} declares tools`);
  }
  return `${Object.keys(PROMPT_TEMPLATES).length} templates, 0 tools`;
});

check("every template stays under the hard token ceiling", () => {
  for (const [id, t] of Object.entries(PROMPT_TEMPLATES)) {
    assert(t.maxTokens > 0 && t.maxTokens <= MAX_TEMPLATE_TOKENS, `${id} maxTokens=${t.maxTokens}`);
  }
  return `ceiling=${MAX_TEMPLATE_TOKENS}`;
});

check("the ocr template caches its static code-reference block", () => {
  const breaks = cacheBreakpoints("ocr");
  assert(breaks.length === 1, `expected 1 cache breakpoint, got ${breaks.length}`);
  assert(breaks[0].cache_control.type === "ephemeral", "breakpoint is not ephemeral");
  assert(/NEURO CPT REFERENCE/.test(breaks[0].text), "the cached block is not the code reference");
  assert(breaks[0].text.length > 2000, "the cached block is implausibly small");
  const sys = PROMPT_TEMPLATES.ocr.system;
  assert(sys[sys.length - 1] === breaks[0], "the cache breakpoint must be the last system block");
  return `cached block = ${breaks[0].text.length} chars`;
});

check("the cached block is byte-identical between two builds", () => {
  const a = cacheBreakpoints("ocr")[0].text;
  const b = cacheBreakpoints("ocr")[0].text;
  assert(a === b, "the cached prefix is not stable");
  return `${a.length} chars, stable`;
});

/* ------------------------------------------------------------------ 2. LIVE */

const PREVIEW = process.env.PREVIEW || "";
const AUTH = process.env.AUTH || "";
const live = { ran: false, reason: "", probes: [] };

if (PREVIEW && AUTH) {
  live.ran = true;
  const [headerName, ...rest] = AUTH.split(":");
  const headers = { "Content-Type": "application/json", [headerName.trim()]: rest.join(":").trim() };
  const probes = [
    { name: "system + messages", body: { system: "x", messages: [] }, expect: 400 },
    { name: "template + tools", body: { template: "ocr", tools: [{}] }, expect: 400 },
    { name: "unknown template", body: { template: "nope", params: {} }, expect: 400 },
    { name: "template + maxTokens", body: { template: "ocr", maxTokens: 200000 }, expect: 400 },
  ];
  for (const p of probes) {
    try {
      const res = await fetch(`${PREVIEW}/api/claude`, {
        method: "POST",
        headers,
        body: JSON.stringify(p.body),
      });
      const json = await res.json().catch(() => ({}));
      const ok = res.status === p.expect;
      if (!ok) failures += 1;
      live.probes.push({ name: p.name, status: res.status, expected: p.expect, code: json.code, correlationId: json.correlationId, pass: ok });
    } catch (e) {
      failures += 1;
      live.probes.push({ name: p.name, error: String(e?.message || e), pass: false });
    }
  }
} else {
  live.reason =
    "PREVIEW and/or AUTH not set — the live HTTP probes need a running server and a real Clerk session. NOT RUN (not passed).";
}

/* --------------------------------------------------------------- reporting */

const summary = {
  node: "N00c-pwa-lock-llm-proxy",
  invariant: "INV-SERVER-PROMPTS",
  generatedAt: new Date().toISOString(),
  static: {
    total: results.length,
    passed: results.filter((r) => r.status === "pass").length,
    failed: results.filter((r) => r.status === "fail").length,
    results,
  },
  live,
  ok: failures === 0,
};

mkdirSync(dirname(EVIDENCE), { recursive: true });
writeFileSync(EVIDENCE, JSON.stringify(summary, null, 2) + "\n");

for (const r of results) {
  console.log(`${r.status === "pass" ? "PASS" : "FAIL"}  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
}
if (live.ran) {
  for (const p of live.probes) {
    console.log(`${p.pass ? "PASS" : "FAIL"}  [live] ${p.name} — status ${p.status ?? "n/a"} code ${p.code ?? "n/a"}`);
  }
} else {
  console.log(`SKIP  [live] ${live.reason}`);
}
console.log(`\n${summary.static.passed}/${summary.static.total} static checks passed. Evidence: ${EVIDENCE}`);
process.exit(failures === 0 ? 0 : 1);
