#!/usr/bin/env node
// D36 — specialty tags RANK. They may never restrict.
//
// The failure this prevents is quiet and expensive: tag a code wrong, or fail to tag it
// at all, and a filter makes it unreachable. The doctor cannot log the study, or logs it
// under something else. 353 of the 668 codes the price book serves are untagged, so a
// filter would hide more than half the schedule.
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
  // The client half. These regexes were SQL-shaped only, so when the ranking moved
  // into lib/analytics/search.js the guard would have watched the one place the
  // mistake could no longer be made and ignored the one place it now could.
  /\.filter\s*\([^\n]{0,100}\bspecialt(y|ies)\b/i,   // ')' must be allowed: `.filter((c) => …` has one immediately
  /\bspecialt(y|ies)\b[^\n]{0,40}\?[^\n:]{0,60}:\s*\[\s*\]/i,   // ternary that empties the list
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
// Tagged AMONG THE SERVED codes. Counting every tagged hcpcs instead reported 352
// against a served total of 668, which overstates coverage: 37 of those tags sit on
// codes the price book never returns (no professional component).
const [{ n: tagged }] = (await c.query(
  `select count(*)::int n from reference.code_rvus r
   join reference.fee_schedule_versions v on v.id = r.version_id and v.is_current
   where r.modifier = '26'
     and exists (select 1 from reference.code_specialties s
                 where s.version_id = r.version_id and s.hcpcs = r.hcpcs)`)).rows;
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
