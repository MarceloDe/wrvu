#!/usr/bin/env node
// INV-PROD-AUDITED — every agent-initiated production action is logged, append-only,
// with a snapshot named for any migration, and a rollback path.
import { pass, fail, has, read } from "./_lib.mjs";

const LOG = "goals/evidence/prod-audit-log.jsonl";
if (!has(LOG)) fail(`${LOG} does not exist — production actions have been taken this session, so an empty log is itself the violation`);

const lines = read(LOG).split("\n").filter((l) => l.trim());
if (!lines.length) fail(`${LOG} is empty`);

const problems = [];
lines.forEach((l, i) => {
  let e;
  try { e = JSON.parse(l); } catch { problems.push(`line ${i + 1}: not valid JSON`); return; }
  for (const k of ["ts", "actor", "action", "target", "rollback"]) {
    if (!e[k]) problems.push(`line ${i + 1}: missing required field '${k}'`);
  }
  const isMigration = /migration|schema|DDL/i.test(`${e.action} ${JSON.stringify(e.statements || "")}`);
  if (isMigration && !e.snapshot) {
    problems.push(`line ${i + 1}: a schema change with no snapshot — INV-PROD-AUDITED requires a Neon branch snapshot BEFORE any production migration`);
  }
  if (e.snapshot && !e.snapshot.branch) problems.push(`line ${i + 1}: snapshot present but unnamed`);
});

problems.length ? fail(`${problems.length} problem(s) in the production audit log`, problems)
                : pass(`${lines.length} production action(s) logged, each with actor, target, rollback and (for schema changes) a snapshot`);
