#!/usr/bin/env node
// INV-NO-DEAD-CODE (advisory) — no table, route or module that nothing reads.
import { pass, fail, walk, read, rel, has } from "./_lib.mjs";
import { readFileSync } from "node:fs";

const all = [...walk("app"), ...walk("lib"), ...walk("components"), ...walk("scripts")];
const corpus = all.map((f) => readFileSync(f, "utf8")).join("\n");
const dead = [];

// Drizzle tables that no source file mentions by name.
if (has("lib/db/schema.js")) {
  for (const m of read("lib/db/schema.js").matchAll(/export const (\w+)\s*=\s*pgTable\(\s*["'](\w+)["']/g)) {
    const [, sym, table] = m;
    const uses = all.filter((f) => {
      const s = readFileSync(f, "utf8");
      return !f.endsWith("schema.js") && (new RegExp(`\\b${sym}\\b`).test(s) || new RegExp(`\\b${table}\\b`).test(s));
    });
    if (!uses.length) dead.push(`table '${table}' (schema.js export ${sym}) is referenced by no source file`);
  }
}
// API routes nothing fetches.
for (const f of all.filter((f) => /app\/api\/.*route\.(js|ts)$/.test(f))) {
  const route = rel(f).replace(/^app/, "").replace(/\/route\.(js|ts)$/, "");
  if (!new RegExp(`["'\`]${route}`).test(corpus)) dead.push(`route ${route} has no caller in this repo`);
}

if (dead.length) {
  console.log("ADVISORY — INV-NO-DEAD-CODE findings (not blocking):");
  for (const d of dead) console.log("  " + d);
  pass(`${dead.length} advisory finding(s); severity is advisory, so this does not block`);
}
pass("no dead tables or uncalled routes found");
