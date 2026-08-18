#!/usr/bin/env node
// INV-DESCRIPTOR-SEPARABLE — descriptor text is reached only through descriptor_source.
import { pass, fail, pending, has, walk, rel } from "./_lib.mjs";
import { readFileSync } from "node:fs";

if (!has("lib/reference/descriptorSource.js") && !has("lib/reference/descriptorSource.ts")) {
  pending("the descriptor_source abstraction does not exist yet, so there is no boundary to enforce",
          "N11c lands lib/reference/descriptorSource with the separable descriptor table");
}
const bad = [];
for (const f of [...walk("app"), ...walk("components"), ...walk("lib")]) {
  if (/descriptorSource/.test(f)) continue;
  const s = readFileSync(f, "utf8");
  if (/\b(procedure_descriptors|cms_description|descriptor_long|descriptor_short)\b/.test(s)) bad.push(rel(f));
}
bad.length ? fail(`${bad.length} file(s) read descriptor text outside descriptorSource`, bad)
           : pass("descriptor text is reached only through descriptor_source");
