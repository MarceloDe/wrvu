// Source-level contract checks: the properties that must hold for EVERY route,
// enforced mechanically so a new route cannot quietly reintroduce a leak or a
// swallowed failure. These read the real files on disk — nothing is stubbed.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const routeFiles = walk(join(ROOT, "app", "api")).filter((f) => /route\.(js|ts)$/.test(f));
const read = (f) => readFileSync(f, "utf8");
const rel = (f) => relative(ROOT, f);

// The public health check is the one route with no failure path and no auth.
const PUBLIC_ROUTES = ["app/api/health/route.js"];
const guarded = routeFiles.filter((f) => !PUBLIC_ROUTES.includes(rel(f)));

test("there are routes to check", () => {
  assert.ok(guarded.length >= 5, `expected the API routes, found ${guarded.length}`);
});

test("every guarded route builds its responses through the error envelope", () => {
  for (const file of guarded) {
    const src = read(file);
    assert.match(src, /from "@\/lib\/http\/errors"/, `${rel(file)} does not import the error envelope`);
    const handlers = [...src.matchAll(/export\s+(?:const|async\s+function)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)];
    assert.ok(handlers.length > 0, `${rel(file)} exports no HTTP handler`);
    for (const [, method] of handlers) {
      const re = new RegExp(`export\\s+const\\s+${method}\\s*=\\s*withErrorEnvelope\\(`);
      assert.match(src, re, `${rel(file)} ${method} is not wrapped in withErrorEnvelope()`);
    }
  }
});

test("no route serialises an error string into a response body", () => {
  const banned = [
    /String\(e\)/,
    /String\(err\)/,
    /error:\s*String\(/,
    /error:\s*e\b/,
    /error:\s*err\b/,
    /\berror:\s*detail\b/,
    /\.message\s*\}/,
    /Response\.json\(\s*\{\s*error/,
  ];
  for (const file of routeFiles) {
    const src = read(file);
    for (const re of banned) {
      assert.ok(!re.test(src), `${rel(file)} matches banned error-leak pattern ${re}`);
    }
  }
});

test("every failure a route returns carries a non-2xx status", () => {
  for (const file of guarded) {
    const src = read(file);
    for (const m of src.matchAll(/ctx\.fail\(\s*"([a-z_]+)"\s*,\s*(\d{3})/g)) {
      const status = Number(m[2]);
      assert.ok(status >= 400 && status <= 599, `${rel(file)} returns ${m[1]} with status ${status}`);
    }
  }
});

test("/api/store and /api/extra-duty/rates never answer a failed write with 200", () => {
  for (const name of ["app/api/store/route.js", "app/api/extra-duty/rates/route.js"]) {
    const src = read(join(ROOT, name));
    assert.ok(!/status:\s*200/.test(src), `${name} still pins a 200 status somewhere`);
    // Each catch block must hand off to ctx.fail with a 5xx.
    const catches = [...src.matchAll(/catch\s*\(\s*err\s*\)\s*\{([\s\S]*?)\n  \}/g)];
    assert.ok(catches.length >= 3, `${name} has ${catches.length} catch blocks, expected at least 3`);
    for (const [, body] of catches) {
      assert.match(body, /ctx\.fail\(/, `${name} has a catch block that does not return the envelope`);
    }
  }
});

test("the unauthenticated middleware 401 carries a correlation id", () => {
  const src = read(join(ROOT, "middleware.js"));
  assert.match(src, /errorPayload\("unauthorized",\s*correlationId\)/);
  assert.match(src, /logServerError\(/);
  assert.match(src, /CORRELATION_HEADER/);
});

test("no bare catch block survives anywhere in app/, lib/ or components/", () => {
  const files = ["app", "lib", "components"]
    .flatMap((d) => walk(join(ROOT, d)))
    .filter((f) => /\.(js|jsx|ts|tsx|mjs)$/.test(f));
  for (const file of files) {
    const src = read(file);
    assert.ok(!/catch\s*(\([^)]*\))?\s*\{\s*\}/.test(src), `${rel(file)} still has an empty catch block`);
  }
});

test("eslint enforces no-empty with allowEmptyCatch disabled", () => {
  const cfg = JSON.parse(read(join(ROOT, ".eslintrc.json")));
  assert.deepEqual(cfg.rules["no-empty"], ["error", { allowEmptyCatch: false }]);
});

test("structured logging is wired to a monitoring destination", () => {
  const src = read(join(ROOT, "lib", "observability", "logger.ts"));
  assert.match(src, /ERROR_MONITOR_URL/, "logger has no monitoring destination");
  assert.match(src, /JSON\.stringify\(/, "logger does not emit structured lines");
  assert.match(src, /correlationId/, "log lines carry no correlation id");
});
