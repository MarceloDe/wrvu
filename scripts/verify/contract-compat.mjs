#!/usr/bin/env node
// INV-ADDITIVE-CONTRACTS — API changes are additive only.
import { pass, fail, pending, has } from "./_lib.mjs";
import { execSync } from "node:child_process";

const SPEC = "contracts/openapi.yaml";
if (!has(SPEC)) {
  pending(`${SPEC} does not exist, so there is no machine-readable contract to diff`,
          "N22a lands contracts/openapi.yaml");
}
const base = process.argv.includes("--base") ? process.argv[process.argv.indexOf("--base") + 1] : "origin/main";
let before;
try { before = execSync(`git show ${base}:${SPEC}`, { encoding: "utf8" }); }
catch { pending(`${SPEC} does not exist on ${base}, so this is its introduction and nothing can have been removed`, "the spec exists on the base branch"); }

const yaml = await import("yaml").catch(() => null);
if (!yaml) fail("the 'yaml' package is not installed, so the spec cannot be parsed. Add it as a devDependency.");
const A = yaml.parse(before), B = yaml.parse((await import("node:fs")).readFileSync(SPEC, "utf8"));

const removed = [];
const walkPaths = (o, p = []) => {
  for (const k of Object.keys(o ?? {})) {
    const at = [...p, k];
    const other = at.reduce((acc, key) => acc?.[key], B);
    if (other === undefined) removed.push(at.join("."));
    else if (o[k] && typeof o[k] === "object") walkPaths(o[k], at);
  }
};
walkPaths(A.paths ?? {}, ["paths"]);
walkPaths(A.components?.schemas ?? {}, ["components", "schemas"]);

removed.length ? fail(`${removed.length} contract element(s) REMOVED — additive-only means nothing disappears in one release`, removed)
               : pass("no path, operation or schema field was removed");
