// Unit tests for the error envelope itself (pure functions, no mocks, no I/O).
// The wire behaviour these describe is proven separately, against a real server,
// by scripts/verify/fault-injection.mjs.

import test from "node:test";
import assert from "node:assert/strict";
import {
  CORRELATION_HEADER,
  ERROR_CODES,
  errorPayload,
  fail,
  newCorrelationId,
} from "../lib/http/errors.ts";

test("fail() body is exactly { error: { code, correlationId } }", async () => {
  const res = fail("internal_error", "cid-123", 500);
  const body = await res.json();
  assert.deepEqual(Object.keys(body), ["error"]);
  assert.deepEqual(Object.keys(body.error).sort(), ["code", "correlationId"]);
  assert.equal(body.error.code, "internal_error");
  assert.equal(body.error.correlationId, "cid-123");
});

test("fail() carries the status and the correlation header", async () => {
  for (const status of [400, 401, 404, 500, 503]) {
    const res = fail("bad_request", "cid-abc", status);
    assert.equal(res.status, status);
    assert.equal(res.headers.get(CORRELATION_HEADER), "cid-abc");
    assert.equal(res.headers.get("content-type"), "application/json");
  }
});

test("fail() serialises no other field, whatever the code", async () => {
  for (const code of ERROR_CODES) {
    const res = fail(code, "cid-xyz", 500);
    const text = await res.text();
    assert.equal(text, JSON.stringify({ error: { code, correlationId: "cid-xyz" } }));
  }
});

test("errorPayload() is the same shape fail() serialises", () => {
  assert.deepEqual(errorPayload("unauthorized", "cid-1"), {
    error: { code: "unauthorized", correlationId: "cid-1" },
  });
});

test("no error code leaks an internal, driver or vendor term", () => {
  const forbidden = [
    "postgres", "pg", "neon", "sql", "column", "constraint", "relation", "duplicate",
    "drizzle", "clerk", "anthropic", "claude", "stack", "syntax",
  ];
  for (const code of ERROR_CODES) {
    for (const word of forbidden) {
      assert.ok(!code.includes(word), `error code "${code}" contains "${word}"`);
    }
    assert.match(code, /^[a-z_]+$/, `error code "${code}" is not a bare snake_case token`);
  }
});

test("newCorrelationId() is non-empty and unique across calls", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 1000; i += 1) {
    const id = newCorrelationId();
    assert.ok(id.length >= 8, `correlation id too short: ${id}`);
    assert.ok(!seen.has(id), `correlation id repeated: ${id}`);
    seen.add(id);
  }
});
