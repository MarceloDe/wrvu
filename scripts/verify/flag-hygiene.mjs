#!/usr/bin/env node
// INV-ALWAYS-SHIPPABLE (flag half) — incomplete work sits behind a flag that is
// OFF in production, with a named owner and a removal node.
import { pass, fail, walk, rel, has, read } from "./_lib.mjs";
import { readFileSync } from "node:fs";

const REG = "goals/FLAGS.yaml";
const declared = new Map();
if (has(REG)) {
  let cur = null;
  for (const line of read(REG).split("\n")) {
    const m = line.match(/^\s{2}(\w[\w-]*):\s*$/);
    if (m) { cur = m[1]; declared.set(cur, {}); continue; }
    const kv = line.match(/^\s{4}(\w+):\s*(.+?)\s*$/);
    if (cur && kv) declared.get(cur)[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
}

const used = new Set();
for (const f of [...walk("app"), ...walk("lib"), ...walk("components")]) {
  for (const m of readFileSync(f, "utf8").matchAll(/\bFLAGS?\.(\w+)|isEnabled\(\s*["'](\w+)["']/g)) {
    used.add(m[1] || m[2]);
  }
}

const problems = [];
for (const f of used) {
  if (!declared.has(f)) { problems.push(`flag '${f}' is used in code but not declared in ${REG}`); continue; }
  const d = declared.get(f);
  if (!d.owner) problems.push(`flag '${f}' has no owner`);
  if (!d.removal_node) problems.push(`flag '${f}' has no removal_node — a flag with no exit plan is permanent`);
  if (d.production !== "off" && d.production !== "false") {
    problems.push(`flag '${f}' is '${d.production}' in production; D33a requires OFF until the work is complete`);
  }
}
if (problems.length) fail(`${problems.length} feature-flag hygiene problem(s)`, problems);
if (used.size === 0 && declared.size === 0) {
  pass("no feature flags in use and none declared — nothing to police");
}
pass(`${used.size} flag(s) in use, all declared with an owner, a removal node, and off in production`);
