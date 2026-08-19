#!/usr/bin/env node
// N03 — prove main is actually protected, by trying to break it.
//
// A green CI does not prove a merge is gated. Branch protection can require a status
// context that never reports, or exempt admins — and every actor on this repo holds an
// admin token, so `enforce_admins: false` would make the whole gate decorative.
//
// SAFETY: the PR under test must be one whose accidental merge is harmless. The poison
// branches qualify by construction — poison.mjs only ever writes under scripts/, which
// `npm run lint` covers and `next build` does not compile, so even a catastrophic
// protection failure leaves production deployable and costs one revert.
//
// A draft PR cannot be merged regardless of protection, so a refusal on a draft proves
// nothing. This undrafts the PR before attempting, and requires the refusal to name a
// protection reason rather than draftness.
import { pass, fail, pending } from "./_lib.mjs";
import { execSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const out = arg("--out");
const prArg = arg("--pr");
const REQUIRED_CONTEXT = arg("--context") || "checks";

const sh = (c) => execSync(c, { encoding: "utf8" }).trim();
const tryJson = (c) => { const r = spawnSync("sh", ["-c", c], { encoding: "utf8" }); return { ok: r.status === 0, body: `${r.stdout}${r.stderr}` }; };

const prot = tryJson("gh api repos/:owner/:repo/branches/main/protection 2>&1");
if (!prot.ok) {
  if (/Branch not protected/i.test(prot.body)) {
    pending("main has no branch protection, so there is no merge gate to test", "the operator (or N03) enables branch protection on main");
  }
  fail("could not read branch protection on main", [prot.body.slice(0, 300)]);
}
const p = JSON.parse(prot.body);

const problems = [];
const contexts = p.required_status_checks?.contexts ?? [];
if (!contexts.includes(REQUIRED_CONTEXT)) problems.push(`required_status_checks.contexts is [${contexts.join(", ") || "empty"}] — it does not require "${REQUIRED_CONTEXT}", so a red build does not block a merge`);
if (p.required_status_checks?.strict !== true) problems.push("required_status_checks.strict is false — a stale branch can merge without re-running CI against current main");
if (p.enforce_admins?.enabled !== true) problems.push("enforce_admins is false — every token on this repo is an admin token, so the gate is decorative");
if (p.allow_force_pushes?.enabled === true) problems.push("allow_force_pushes is enabled — history on main can be rewritten past the gate");
if (problems.length) fail(`branch protection on main is present but does not gate`, problems);

if (!prArg) fail("usage: merge-blocked.mjs --pr <number of an OPEN, RED, harmless PR> [--out FILE]");

const view = JSON.parse(sh(`gh pr view ${prArg} --json number,isDraft,state,mergeStateStatus,statusCheckRollup,headRefName,title`));
if (view.state !== "OPEN") fail(`PR #${prArg} is ${view.state}; a closed PR cannot be merge-tested`);
if (!/^poison\//.test(view.headRefName)) fail(`PR #${prArg} is on '${view.headRefName}'. Refusing: only a poison branch is safe to attempt a real merge on`);
const red = (view.statusCheckRollup ?? []).some((c) => c.conclusion === "FAILURE");
if (!red) fail(`PR #${prArg} is not red — a merge refusal would not prove the status gate`, [JSON.stringify(view.statusCheckRollup)]);

if (view.isDraft) sh(`gh pr ready ${prArg}`);
const after = JSON.parse(sh(`gh pr view ${prArg} --json isDraft,mergeStateStatus`));
if (after.isDraft) fail(`PR #${prArg} is still a draft; a refusal could not be attributed to protection`);
if (after.mergeStateStatus !== "BLOCKED") fail(`GitHub reports mergeStateStatus=${after.mergeStateStatus} for a red PR, expected BLOCKED. Refusing to attempt the merge`);

const attempt = tryJson(`gh api -X PUT repos/:owner/:repo/pulls/${prArg}/merge -f merge_method=squash 2>&1`);
sh(`gh pr ready --undo ${prArg}`);   // restore the DO-NOT-MERGE draft state

const result = {
  pr: Number(prArg), branch: view.headRefName,
  protection: { contexts, strict: p.required_status_checks?.strict, enforceAdmins: p.enforce_admins?.enabled },
  mergeAttempt: { refused: !attempt.ok, response: attempt.body.slice(0, 400) },
};
if (out) writeFileSync(out, JSON.stringify(result, null, 2));

if (attempt.ok) fail(`THE MERGE SUCCEEDED. A red PR was merged into main — protection is not enforcing. Revert #${prArg} immediately`, [attempt.body.slice(0, 300)]);
if (/draft/i.test(attempt.body) && !/protect|status check|required/i.test(attempt.body)) {
  fail("the merge was refused for draftness, not protection — this proves nothing", [attempt.body.slice(0, 300)]);
}
pass(`main is protected: a red PR (#${prArg}) was refused by the API${out ? ` -> ${out}` : ""}`);
