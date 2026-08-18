// Server-owned prompt registry — the whole of INV-SERVER-PROMPTS lives here.
//
// The browser may name a template id and pass typed parameters. It may NOT pass
// a system prompt, a tool definition, a model, a message array or a token
// budget: those are resolved from the registry entry and from nowhere else.
// A request carrying any of them is rejected before the upstream vendor is
// contacted at all.
//
// D8: no template declares a search tool, and none ever may — assertNoSearchTools()
// is exercised by scripts/test/llm-proxy-contract.mjs.

import { extractionSystemBlocks, extractionUserText } from "../ocr-prompt.js";
import { timelineSystemPrompt, timelineUserText } from "../timeline-prompt.js";

// Hard ceiling. No registry entry may exceed it and no request may raise it.
export const MAX_TEMPLATE_TOKENS = 8000;

// Attachments arrive as Anthropic content blocks — the very objects the client's
// redaction path produced, which is what lets the browser-side guard prove
// provenance by object identity. The server trusts none of it: it re-validates
// type, media type and size, and rebuilds the block it sends upstream.
const IMAGE_MEDIA_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const MAX_ATTACHMENT_BYTES = 6 * 1024 * 1024; // per attachment, base64-decoded

/**
 * PromptTemplate = {
 *   id, system, tools, maxTokens, paramsSchema,
 *   userText, attachments: { min, max, mediaTypes }
 * }
 * `paramsSchema` is closed: a param not named here is rejected.
 */
export const PROMPT_TEMPLATES = {
  ocr: {
    id: "ocr",
    system: extractionSystemBlocks(),
    tools: [],
    maxTokens: 8000,
    paramsSchema: {},
    userText: extractionUserText,
    attachments: { min: 1, max: 8, mediaTypes: IMAGE_MEDIA_TYPES },
  },
  timeline: {
    id: "timeline",
    system: [{ type: "text", text: timelineSystemPrompt() }],
    tools: [],
    maxTokens: 4000,
    paramsSchema: {},
    userText: timelineUserText,
    attachments: { min: 1, max: 1, mediaTypes: [...IMAGE_MEDIA_TYPES, "application/pdf"] },
  },
};

// Fields only the server may decide. Presence of any of them is a hard 400 —
// silently ignoring them would let a client believe it had set one.
export const SERVER_OWNED_FIELDS = [
  "system",
  "tools",
  "tool_choice",
  "toolChoice",
  "maxTokens",
  "max_tokens",
  "model",
  "messages",
  "temperature",
  "top_k",
  "top_p",
  "stream",
  "thinking",
  "service_tier",
  "metadata",
  "anthropic_version",
  "anthropic_beta",
];

const ALLOWED_FIELDS = ["template", "params", "attachments"];

function reject(code, detail) {
  return { ok: false, status: 400, code, detail };
}

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * One attachment, as a content block: { type, source: { type, media_type, data } }.
 * `document` is admitted for application/pdf only — an image smuggled inside a
 * document block is rejected here as well as by the browser-side guard.
 */
function parseAttachment(value, allowedTypes) {
  if (!isPlainObject(value)) return { ok: false, code: "invalid_attachment" };
  for (const key of Object.keys(value)) {
    if (key !== "type" && key !== "source") return { ok: false, code: "invalid_attachment" };
  }
  const kind = value.type;
  if (kind !== "image" && kind !== "document") return { ok: false, code: "invalid_attachment" };
  const source = value.source;
  if (!isPlainObject(source)) return { ok: false, code: "invalid_attachment" };
  for (const key of Object.keys(source)) {
    if (key !== "type" && key !== "media_type" && key !== "data") {
      return { ok: false, code: "invalid_attachment" };
    }
  }
  if (source.type !== "base64") return { ok: false, code: "invalid_attachment" };

  const mediaType = String(source.media_type || "").toLowerCase();
  if (!allowedTypes.includes(mediaType)) return { ok: false, code: "unsupported_media_type" };
  if (kind === "document" && mediaType !== "application/pdf") {
    return { ok: false, code: "unsupported_media_type" };
  }
  if (kind === "image" && !mediaType.startsWith("image/")) {
    return { ok: false, code: "unsupported_media_type" };
  }

  const data = typeof source.data === "string" ? source.data.replace(/\s+/g, "") : "";
  if (!data || !BASE64.test(data)) return { ok: false, code: "invalid_attachment" };
  // base64 -> bytes, without decoding the payload.
  const bytes = Math.floor((data.length * 3) / 4);
  if (bytes > MAX_ATTACHMENT_BYTES) return { ok: false, code: "attachment_too_large" };
  return { ok: true, kind: mediaType === "application/pdf" ? "document" : "image", mediaType, data };
}

function validateParams(schema, params) {
  for (const key of Object.keys(params)) {
    if (!Object.prototype.hasOwnProperty.call(schema, key)) {
      return { ok: false, code: "unknown_param", detail: key };
    }
  }
  for (const [key, spec] of Object.entries(schema)) {
    const present = Object.prototype.hasOwnProperty.call(params, key);
    if (!present) {
      if (spec.required) return { ok: false, code: "missing_param", detail: key };
      continue;
    }
    const value = params[key];
    if (spec.type === "string") {
      if (typeof value !== "string") return { ok: false, code: "invalid_param", detail: key };
      if (spec.maxLength && value.length > spec.maxLength)
        return { ok: false, code: "invalid_param", detail: key };
      if (spec.enum && !spec.enum.includes(value))
        return { ok: false, code: "invalid_param", detail: key };
    } else if (spec.type === "number") {
      if (typeof value !== "number" || !Number.isFinite(value))
        return { ok: false, code: "invalid_param", detail: key };
    } else if (spec.type === "boolean") {
      if (typeof value !== "boolean") return { ok: false, code: "invalid_param", detail: key };
    } else {
      return { ok: false, code: "invalid_param", detail: key };
    }
  }
  return { ok: true };
}

/**
 * The single request gate for /api/claude. Pure: no I/O, no clock, no network —
 * which is what makes it directly unit-testable under D20 without a mock.
 *
 * @returns {{ok:true, template, params, attachments}|{ok:false,status,code,detail}}
 */
export function parseProxyRequest(body) {
  if (!isPlainObject(body)) return reject("invalid_body");

  for (const field of SERVER_OWNED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      return reject("server_owned_field", field);
    }
  }
  for (const key of Object.keys(body)) {
    if (!ALLOWED_FIELDS.includes(key)) return reject("unknown_field", key);
  }

  const { template: templateId } = body;
  if (typeof templateId !== "string" || !templateId) return reject("invalid_template");
  if (!Object.prototype.hasOwnProperty.call(PROMPT_TEMPLATES, templateId))
    return reject("unknown_template");
  const template = PROMPT_TEMPLATES[templateId];

  if (!Object.prototype.hasOwnProperty.call(body, "params")) return reject("missing_params");
  if (!isPlainObject(body.params)) return reject("invalid_params");
  const paramsResult = validateParams(template.paramsSchema, body.params);
  if (!paramsResult.ok) return reject(paramsResult.code, paramsResult.detail);

  const raw = Object.prototype.hasOwnProperty.call(body, "attachments") ? body.attachments : [];
  if (!Array.isArray(raw)) return reject("invalid_attachment");
  const { min = 0, max = 0, mediaTypes = [] } = template.attachments || {};
  if (raw.length < min) return reject("missing_attachment");
  if (raw.length > max) return reject("too_many_attachments");

  const attachments = [];
  for (const item of raw) {
    const parsed = parseAttachment(item, mediaTypes);
    if (!parsed.ok) return reject(parsed.code);
    attachments.push({ kind: parsed.kind, mediaType: parsed.mediaType, data: parsed.data });
  }

  return { ok: true, template, params: body.params, attachments };
}

/**
 * Build the upstream request body. Every field that costs money — model, token
 * budget, system prompt, tools — comes from the registry entry.
 */
export function buildAnthropicRequest(template, attachments, model) {
  const content = attachments.map((a) => ({
    type: a.kind,
    source: { type: "base64", media_type: a.mediaType, data: a.data },
  }));
  content.push({ type: "text", text: template.userText });

  const body = {
    model: model || "claude-sonnet-4-6",
    max_tokens: Math.min(template.maxTokens, MAX_TEMPLATE_TOKENS),
    system: template.system,
    messages: [{ role: "user", content }],
  };
  if (template.tools && template.tools.length) body.tools = template.tools;
  return body;
}

// D8 guard: a registry entry may not declare a hosted search tool of any kind.
const FORBIDDEN_TOOL_PATTERN = /search|browse|fetch|bash|computer|code_execution/i;

export function assertNoSearchTools() {
  const offenders = [];
  for (const [id, t] of Object.entries(PROMPT_TEMPLATES)) {
    for (const tool of t.tools || []) {
      const label = `${tool?.type || ""} ${tool?.name || ""}`;
      if (FORBIDDEN_TOOL_PATTERN.test(label)) offenders.push(`${id}:${label.trim()}`);
    }
  }
  return offenders;
}

// Templates whose cached prefix must stay cached. Verified by the contract test
// and, end to end, by cache_read_input_tokens on the second identical call.
export function cacheBreakpoints(templateId) {
  const t = PROMPT_TEMPLATES[templateId];
  if (!t) return [];
  return (Array.isArray(t.system) ? t.system : []).filter((b) => b && b.cache_control);
}
