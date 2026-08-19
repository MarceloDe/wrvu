#!/usr/bin/env node
// D36 — specialty tags RANK. They may never restrict.
//
// The failure this prevents is quiet and expensive: tag a code wrong, or fail to tag it
// at all, and a filter makes it unreachable. The doctor cannot log the study, or logs it
// under something else. 476 of the 828 codes are untagged today, so a filter would hide
// most of the schedule.
//
// Two halves. STATIC: no query narrows results by specialty. RUNTIME: the number of codes
// the price book returns equals the number in the release, tagged or not.
import { pass, fail, pending, walk, rel, read, has } from "./_lib.mjs";
import { readFileSync } from "node:fs";

const problems = [];

// A specialty predicate in a WHERE/AND/HAVING narrows the result set. Joining the table
// for ordering is fine; filtering on it is not.
const RESTRICTING = [
  /\b(where|and|having)\b[^\n;]{0,80}\bspecialt(y|ies)\b\s*(=|in|any|@>|&&)/i,
  /\bfilter\s*\(\s*where[^\n)]{0,60}\bspecialt/i,
];
for (const f of [...walk("app"), ...walk("lib"), ...walk("scripts"), ...walk("components")]) {
  const r = rel(f);
  if (r === "scripts/verify/taxonomy-never-restricts.mjs") continue;
  readFileSync(f, "utf8").split("\n").forEach((line, i) => {
    if (line.trim().startsWith("//") || line.trim().startsWith("--")) return;
    if (RESTRICTING.some((re) => re.test(line))) {
      problems.push(`${r}:${i + 1}  narrows results by specialty — tags must order, not filter\n        ${line.trim().slice(0, 100)}`);
    }
  });
}

// The price book must still be the whole release.
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  if (problems.length) fail(`${problems.length} restricting use(s) of specialty`, problems);
  pending("no database URL, so the completeness half could not run", "run with --env-file=.env.local");
}
const pg = (await import("pg")).default;
const c = new pg.Client({ connectionString: url });
try { await c.connect(); }
catch (e) { pending(`could not connect (${String(e.message).slice(0, 60)})`, "a reachable database"); }

const [{ n: inRelease }] = (await c.query(
  `select count(*)::int n from reference.code_rvus r
   join reference.fee_schedule_versions v on v.id = r.version_id and v.is_current
   where r.modifier = '26'`)).rows;
// The exact query the route runs, tags joined in.
const [{ n: served }] = (await c.query(
  `select count(*)::int n from reference.code_rvus r
   join reference.fee_schedule_versions v on v.id = r.version_id and v.is_current
   left join reference.procedure_codes c on c.version_id = r.version_id and c.hcpcs = r.hcpcs
   where r.modifier = '26'`)).rows;
const [{ n: tagged }] = (await c.query(
  `select count(distinct s.hcpcs)::int n from reference.code_specialties s
   join reference.fee_schedule_versions v on v.id = s.version_id and v.is_current`)).rows;
await c.end();

if (served !== inRelease) {
  problems.push(`the price book serves ${served} codes but the release has ${inRelease} — joining the tags dropped rows, which means an untagged code is now unreachable`);
}
if (tagged >= inRelease) {
  problems.push(`every code is tagged (${tagged}/${inRelease}) — suspicious: the derivation should leave 'other' untagged rather than guessing`);
}

problems.length
  ? fail(`${problems.length} problem(s) with the specialty taxonomy`, problems)
  : pass(`tags rank only: ${tagged} of ${inRelease} codes tagged, all ${served} still served, and nothing filters by specialty`);
