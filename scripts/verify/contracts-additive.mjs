#!/usr/bin/env node
// INV-ADDITIVE-CONTRACTS (D33b) — you may add to the contract; you may not take away.
//
// TestFlight builds already on colleagues' phones decode these shapes and cannot be
// patched quickly. Adding an optional field costs nothing: both decoders ignore keys they
// do not know. REMOVING or RENAMING one, or making an existing field required, breaks
// every installed build at once — and it looks like a small diff.
//
// contracts/surface.lock.json is the last agreed surface. A removal fails here. An
// addition is fine, and re-locking it is itself a reviewable diff, which is the point:
// somebody has to look at the change to the contract, deliberately.
import { pass, fail, has, read } from "./_lib.mjs";
import { parse } from "yaml";

const LOCK = "contracts/surface.lock.json";
if (!has("contracts/openapi.yaml")) fail("contracts/openapi.yaml does not exist");
const spec = parse(read("contracts/openapi.yaml"));

function surface(s) {
  const out = { paths: {}, schemas: {} };
  for (const [p, ops] of Object.entries(s.paths ?? {})) {
    out.paths[p] = Object.keys(ops).filter((k) => ["get", "post", "put", "patch", "delete"].includes(k)).sort();
  }
  for (const [n, sc] of Object.entries(s.components?.schemas ?? {})) {
    out.schemas[n] = {
      properties: Object.keys(sc.properties ?? {}).sort(),
      required: [...(sc.required ?? [])].sort(),
      enum: sc.enum ? [...sc.enum].sort() : undefined,
    };
  }
  return out;
}
const now = surface(spec);

if (!has(LOCK)) {
  fail(`${LOCK} does not exist, so no change can be judged additive`,
       ["create it once with: node scripts/contracts/generate.mjs --lock"]);
}
const was = JSON.parse(read(LOCK));

const problems = [];
for (const [p, methods] of Object.entries(was.paths)) {
  if (!now.paths[p]) { problems.push(`REMOVED PATH  ${p} — every installed client that calls it breaks`); continue; }
  for (const m of methods) if (!now.paths[p].includes(m)) problems.push(`REMOVED METHOD  ${m.toUpperCase()} ${p}`);
}
for (const [n, sc] of Object.entries(was.schemas)) {
  const cur = now.schemas[n];
  if (!cur) { problems.push(`REMOVED SCHEMA  ${n}`); continue; }
  for (const f of sc.properties) if (!cur.properties.includes(f)) problems.push(`REMOVED FIELD  ${n}.${f} — a decoder expecting it gets nothing`);
  for (const v of sc.enum ?? []) if (v !== null && !(cur.enum ?? []).includes(v)) problems.push(`REMOVED ENUM VALUE  ${n}.${v}`);
  for (const f of cur.required) if (!sc.required.includes(f)) problems.push(`NEWLY REQUIRED  ${n}.${f} — an older client that omits it now fails validation`);
}

const added = [];
for (const [n, sc] of Object.entries(now.schemas)) {
  const old = was.schemas[n];
  if (!old) { added.push(`new schema ${n}`); continue; }
  for (const f of sc.properties) if (!old.properties.includes(f)) added.push(`${n}.${f}`);
}
for (const [p, methods] of Object.entries(now.paths)) {
  if (!was.paths[p]) { added.push(`new path ${p}`); continue; }
  // A new METHOD on an existing path is an addition too. Reporting it as "no change"
  // was wrong: the whole point of the lock is that somebody looks at a surface change
  // deliberately, and a PUT appearing on a path that already had a GET is exactly that.
  for (const m of methods) if (!was.paths[p].includes(m)) added.push(`new method ${m.toUpperCase()} ${p}`);
}

problems.length
  ? fail(`${problems.length} non-additive contract change(s)`, [...problems, "", "If this removal is intended, it needs a coordinated client release — not a re-lock."])
  : pass(`contract change is additive${added.length ? `: ${added.length} addition(s) — ${added.slice(0, 6).join(", ")}` : " (no change)"}`);
