#!/usr/bin/env node
// Poll for a GitHub Actions run whose headSha MATCHES, then wait for completion.
// Never picks a stale run — that was a real defect in an earlier N03 draft.
//
// It must also never pick the WRONG WORKFLOW. This repo has a Copilot review workflow
// that reports on the same sha; matching on headSha alone returned its run, whose steps
// are "Setup Agent"/"Clean Up" and contain none of the checks. A poison assertion
// against that run would be meaningless, and a green from it would be a false PASS.
import { pass, fail } from "./_lib.mjs";
import { execSync } from "node:child_process";
const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const branch = arg("--branch"), sha = arg("--sha"), out = arg("--out");
const workflow = arg("--workflow") || ".github/workflows/ci.yml";
if (!branch || !sha || !out) fail("usage: gh-wait-run.mjs --branch B --sha SHA --out FILE [--workflow NAME]");

const gh = (c) => JSON.parse(execSync(`gh ${c}`, { encoding: "utf8" }));
let run = null;
for (let i = 0; i < 60; i++) {
  const runs = gh(`run list --branch ${branch} -L 20 --json databaseId,headSha,status,conclusion,event,workflowName`);
  const matches = runs.filter((r) => r.headSha === sha && r.workflowName === workflow);
  if (matches.length > 1) fail(`${matches.length} runs of '${workflow}' for sha ${sha} — cannot tell which one gates`, matches.map((m) => `${m.databaseId} ${m.status}/${m.conclusion}`));
  run = matches[0] ?? null;
  if (run && run.status === "completed") break;
  if (i === 59) {
    const seen = runs.filter((r) => r.headSha === sha).map((r) => r.workflowName);
    fail(`no completed run of '${workflow}' for sha ${sha} on ${branch} after 10 minutes`, [`workflows seen on this sha: ${seen.join(", ") || "none"}`]);
  }
  execSync("sleep 10");
}
const jobs = gh(`run view ${run.databaseId} --json jobs`).jobs;
const payload = { ...run, jobs: jobs.map((j) => ({ name: j.name, conclusion: j.conclusion, steps: j.steps.map((s) => ({ name: s.name, conclusion: s.conclusion })) })) };
(await import("node:fs")).writeFileSync(out, JSON.stringify(payload, null, 2));
pass(`run ${run.databaseId} for sha ${sha.slice(0, 8)} completed: ${run.conclusion} -> ${out}`);
