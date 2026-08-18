#!/usr/bin/env node
// INV-SOURCE-PERMISSIBLE — every benchmark source declares a terms_basis; no LinkedIn.
import { pass, fail, pending, walk, rel, has } from "./_lib.mjs";
import { readFileSync } from "node:fs";

// The LinkedIn prohibition (D21a) applies NOW, whether or not the port exists.
const li = [];
for (const f of [...walk("lib"), ...walk("app"), ...walk("scripts"), ...walk("components")]) {
  if (rel(f) === "scripts/verify/source-terms.mjs") continue; // this checker names the thing it forbids
  const src = readFileSync(f, "utf8");
  // Strip comments: naming the prohibition in prose is not violating it.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  if (/linkedin/i.test(code)) li.push(rel(f));
}
if (li.length) fail("D21a forbids a LinkedIn adapter; references found", li);

const portDir = "lib/benchmarks";
if (!has(portDir)) {
  pending("no ProductivityBenchmarkSource port exists yet, so there are no adapters to check; the LinkedIn prohibition was checked and holds",
          "N46a lands lib/benchmarks/ with the source port");
}
const bad = [];
for (const f of walk(portDir)) {
  const s = readFileSync(f, "utf8");
  if (/export\s+(const|default|class)/.test(s) && !/terms_basis|termsBasis/.test(s)) bad.push(rel(f));
}
bad.length ? fail(`${bad.length} adapter(s) with no terms_basis`, bad)
           : pass("every benchmark adapter declares a terms_basis, and no LinkedIn adapter exists");
