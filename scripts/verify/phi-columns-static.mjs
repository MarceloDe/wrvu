#!/usr/bin/env node
// INV-NO-PHI-IN-CLOUD, the half that can run without a database.
//
// phi-schema-scan.mjs introspects the LIVE schema and deliberately FAILS rather than
// skipping when no DATABASE_URL is present — an unscanned schema proves nothing. That is
// the right call, and it also means the check cannot run in CI, which has no database.
//
// So it never gated a pull request. institutions.address, added by migration 0010, sat
// failing the live check on developer machines for days without blocking anything,
// because nothing in CI ever ran it.
//
// This is the static half: it reads the migrations and the Drizzle schema, which is where
// a column is BORN. A patient-shaped column now fails in the pull request that introduces
// it, at the moment someone can still cheaply choose a different design — rather than
// after it has shipped to production and holds rows.
//
// The two halves are complementary, not redundant. This one cannot see a column added by
// hand outside a migration; the live one cannot run in CI. Both are wired up.
import { pass, fail, walk, rel, read, has } from "./_lib.mjs";
import { readFileSync } from "node:fs";

// Person-shaped, not merely "contains the word name". A bare /name$/ matches
// rvu_tables.name and procedure_name, which are not people — a rule you have to
// allowlist your way around is a bad rule, not a strict one.
// Kept in step with phi-schema-scan.mjs.
const BANNED = [
  /^patient/i, /patient_/i,
  /^(first|last|middle|full|given|family)_?name$/i,
  /^mrn$/i, /medical_record/i, /^accession/i,
  /^dob$/i, /date_of_birth/i, /birth_?date/i, /^ssn$/i, /social_security/i,
  /^phone/i, /^fax/i, /^email$/i, /^address/i, /^zip/i, /^postal/i,
  /health_plan/i, /beneficiary/i, /license_number/i, /^ip_address$/i,
];

// Same shape and same reasons as the live scan's allowlist, and printed for the same
// reason: an invisible allowlist is how a PHI check quietly stops being one.
const ALLOW = new Map([
  ["users.email", "PHYSICIAN identity from Clerk. Dead table, dropped by 0009."],
  ["users.first_name", "PHYSICIAN identity from Clerk. Same dead table."],
  ["users.last_name", "PHYSICIAN identity from Clerk. Same dead table."],
  ["institutions.address", "INSTITUTION street address (the physician's workplace), captured in onboarding for a future CMS locality derivation. Optional, never validated. No patient dimension exists on this table."],
]);

const problems = [];
const seen = [];

// --- migrations: create table / add column -------------------------------------------
const sqlFiles = walk("drizzle", [".sql"]);
if (sqlFiles.length === 0) fail("no migrations found under drizzle/ — wrong directory, or the check is looking in the wrong place");

for (const f of sqlFiles) {
  const text = readFileSync(f, "utf8");
  // ALTER TABLE <t> ADD COLUMN <c>
  for (const m of text.matchAll(/alter\s+table\s+"?(\w+)"?\s+add\s+column\s+(?:if\s+not\s+exists\s+)?"?(\w+)"?/gi)) {
    seen.push({ table: m[1], column: m[2], where: rel(f) });
  }
  // CREATE TABLE <t> ( ... ) — take the first identifier of each line inside the parens.
  for (const m of text.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?"?(\w+)"?\s*\(([\s\S]*?)\n\s*\);/gi)) {
    const table = m[1];
    for (const line of m[2].split("\n")) {
      const col = line.trim().match(/^"?(\w+)"?\s+\w/);
      if (!col) continue;
      if (/^(primary|foreign|unique|constraint|check|references)$/i.test(col[1])) continue;
      seen.push({ table, column: col[1], where: rel(f) });
    }
  }
}

// --- the Drizzle schema, which is what the app actually reads -------------------------
if (has("lib/db/schema.js")) {
  const text = read("lib/db/schema.js");
  let table = "?";
  for (const line of text.split("\n")) {
    const t = line.match(/pgTable\("(\w+)"/);
    if (t) { table = t[1]; continue; }
    const c = line.match(/^\s*\w+:\s*\w+\("(\w+)"/);
    if (c) seen.push({ table, column: c[1], where: "lib/db/schema.js" });
  }
}

if (seen.length < 20) {
  fail(`only ${seen.length} column declarations found — the parser is not matching this schema, so a clean result would be meaningless`);
}

for (const { table, column, where } of seen) {
  if (!BANNED.some((re) => re.test(column))) continue;
  const key = `${table}.${column}`;
  if (ALLOW.has(key)) continue;
  problems.push(`${where}  ${key} is patient-shaped. Either it is not patient data — add it to ALLOW with the reason — or the design needs to change before this ships.`);
}

const allowed = [...ALLOW.keys()].filter((k) => seen.some((s) => `${s.table}.${s.column}` === k));
if (allowed.length) {
  console.log("  allowlisted (shown every run, deliberately):");
  for (const k of allowed) console.log(`    ${k} — ${ALLOW.get(k)}`);
}

problems.length
  ? fail(`${problems.length} patient-shaped column(s) declared in the schema`, problems)
  : pass(`${seen.length} column declarations across ${sqlFiles.length} migration(s) and the Drizzle schema; none is patient-shaped`);
