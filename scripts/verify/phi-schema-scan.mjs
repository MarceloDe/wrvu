#!/usr/bin/env node
// INV-NO-PHI-IN-CLOUD — no patient identifier column in any cloud table.
// Runs against a LIVE database. Refuses to pass without one.
import { pass, fail, pending, has, read } from "./_lib.mjs";

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  fail("no DATABASE_URL — this check inspects a LIVE schema and cannot be satisfied statically. Run: node --env-file=.env.local scripts/verify/phi-schema-scan.mjs");
}

// Person-shaped, not merely "contains the word name". A bare /name$/ matches
// rvu_tables.name and procedure_name, which are not people — a rule that has to be
// allowlisted around is a bad rule, not a strict one.
const BANNED = [
  /^patient/i, /patient_/i,
  /^(first|last|middle|full|given|family)_?name$/i,
  /^mrn$/i, /medical_record/i, /^accession/i,
  /^dob$/i, /date_of_birth/i, /birth_?date/i, /^ssn$/i, /social_security/i,
  /^phone/i, /^fax/i, /^email$/i, /^address/i, /^zip/i, /^postal/i,
  /health_plan/i, /beneficiary/i, /license_number/i, /^ip_address$/i,
];
// Columns whose NAME matches but which are provably not PATIENT data. Every entry
// carries a reason and is PRINTED on each run — an invisible allowlist is how a PHI
// check quietly stops being one.
const ALLOW = new Map([
  ["users.email",           "PHYSICIAN identity mirrored from Clerk, not patient data. Table is DEAD (0 rows, no code reads it) and N06g deletes it."],
  ["users.first_name",      "PHYSICIAN identity mirrored from Clerk. Same dead table."],
  ["users.last_name",       "PHYSICIAN identity mirrored from Clerk. Same dead table."],
]);

const { neon } = await import("@neondatabase/serverless");
const sql = neon(url);
const rows = await sql`
  select table_name, column_name
  from information_schema.columns
  where table_schema = 'public'
  order by table_name, column_name`;
if (!rows.length) fail("information_schema returned zero columns — wrong database, or the connection silently failed");

const matched = rows.filter((r) => BANNED.some((re) => re.test(r.column_name)))
                    .map((r) => `${r.table_name}.${r.column_name}`);
const allowed = matched.filter((k) => ALLOW.has(k) || ALLOW.has(`public.${k.split(".")[1]}`));
const hits    = matched.filter((k) => !allowed.includes(k));

if (allowed.length) {
  console.log("  allowlisted (shown every run, deliberately):");
  for (const a of allowed) console.log(`    ${a} — ${ALLOW.get(a) ?? ALLOW.get(`public.${a.split(".")[1]}`)}`);
}

// Timestamp precision: Safe Harbor treats anything finer than a year as an identifier.
const stamps = rows.filter((r) => /_at$|date$/.test(r.column_name)).map((r) => `${r.table_name}.${r.column_name}`);

if (hits.length) fail(`${hits.length} PHI-shaped column(s) in the cloud schema`, hits);
console.log(`  scanned ${rows.length} columns across ${new Set(rows.map(r => r.table_name)).size} tables`);
console.log(`  timestamp-bearing columns (Safe Harbor: finer than a year is an identifier): ${stamps.length}`);
for (const s of stamps) console.log(`    ${s}`);
pass("no PHI-shaped column in the cloud schema");
