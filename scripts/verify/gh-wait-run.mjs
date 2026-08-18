#!/usr/bin/env node
// Poll for a GitHub Actions run whose headSha MATCHES, then wait for completion.
// Never picks a stale run — that was a real defect in an earlier N03 draft.
import { pass, fail } from "./_lib.mjs";
import { execSync } from "node:child_process";
const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const branch = arg("--branch"), sha = arg("--sha"), out = arg("--out");
if (!branch || !sha || !out) fail("usage: gh-wait-run.mjs --branch B --sha SHA --out FILE");

const gh = (c) => JSON.parse(execSync(`gh ${c}`, { encoding: "utf8" }));
let run = null;
for (let i = 0; i < 60; i++) {
  const runs = gh(`run list --branch ${branch} -L 20 --json databaseId,headSha,status,conclusion,event,workflowName`);
  run = runs.find((r) => r.headSha === sha);
  if (run && run.status === "completed") break;
  if (i === 59) fail(`no completed run for sha ${sha} on ${branch} after 10 minutes`);
  execSync("sleep 10");
}
const jobs = gh(`run view ${run.databaseId} --json jobs`).jobs;
const payload = { ...run, jobs: jobs.map((j) => ({ name: j.name, conclusion: j.conclusion, steps: j.steps.map((s) => ({ name: s.name, conclusion: s.conclusion })) })) };
(await import("node:fs")).writeFileSync(out, JSON.stringify(payload, null, 2));
pass(`run ${run.databaseId} for sha ${sha.slice(0, 8)} completed: ${run.conclusion} -> ${out}`);
