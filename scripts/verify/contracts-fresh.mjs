#!/usr/bin/env node
// The generated clients must be what the spec currently says.
//
// A generated file that nobody re-generates is just a stale hand-written file with a
// misleading header — and the header makes it WORSE, because reviewers trust it.
import { pass, fail, has, read, ROOT } from "./_lib.mjs";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OUT = ["contracts/generated/types.ts", "contracts/generated/Contracts.swift"];
if (!has("contracts/openapi.yaml")) fail("contracts/openapi.yaml does not exist");
for (const f of OUT) if (!has(f)) fail(`${f} does not exist — run node scripts/contracts/generate.mjs`);

const before = OUT.map((f) => read(f));
const r = spawnSync("node", [join(ROOT, "scripts/contracts/generate.mjs")], { encoding: "utf8", cwd: ROOT });
if (r.status !== 0) fail(`the generator failed (exit ${r.status})`, [(r.stderr || r.stdout).slice(0, 300)]);
const after = OUT.map((f) => read(f));

const stale = OUT.filter((_, i) => before[i] !== after[i]);
if (stale.length) {
  // Put the files back so a failing check does not also mutate the tree.
  OUT.forEach((f, i) => writeFileSync(join(ROOT, f), before[i]));
  fail(`${stale.length} generated client file(s) are stale`, [
    ...stale.map((f) => `  ${f}`),
    "run: node scripts/contracts/generate.mjs   and commit the result",
  ]);
}
pass(`both generated clients match contracts/openapi.yaml`);
