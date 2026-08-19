#!/usr/bin/env node
// INV-CONTRACT-SYNC — the iOS app decodes these routes, so a rename here is an outage there.
//
// CloudSyncService.swift is a first-class client of fella.cc/api/*: it GETs, POSTs and
// DELETEs against /api/exams, /api/extra-duty and /api/store with a Clerk session
// token. Its Codable structs name every field it expects. Nothing checked that the
// routes still produce them — tests/route-contracts.test.mjs is source-level and only
// looks for the error envelope, so it would have watched a column alias get renamed
// and said nothing.
//
// The PWA would survive such a rename (JS reads undefined and shrugs). Swift would
// not: a missing key on a non-optional field throws, and cloud sync stops for every
// device already on TestFlight. That asymmetry is why this check exists.
//
// The two repos are federated by D43, so an absent checkout is PENDING, not a pass.
import { pass, fail, pending } from "./_lib.mjs";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./_lib.mjs";

const IOS = join(ROOT, "..", "neurorvu-ios");
const SYNC = join(IOS, "NeuroRVU/Reference/CloudSyncService.swift");
if (!existsSync(SYNC)) {
  pending(`${SYNC} is not checked out, so the native contract cannot be compared`,
          "the neurorvu-ios repo sits beside this one (D43 keeps them federated)");
}

const swift = readFileSync(SYNC, "utf8");

// struct Name: Codable { var field: Type ... }
// Stops at the first NESTED struct: RateSnapshotJSON's members (perDiem, mri, ct, xr)
// live inside a jsonb blob, not as SQL columns, and treating them as columns produced
// four confident false positives on the first run of this check.
function fieldsOf(structName) {
  const at = swift.search(new RegExp(`struct\\s+${structName}\\s*:\\s*Codable`));
  if (at < 0) return null;
  const body = swift.slice(at);
  const nested = body.slice(1).search(/\bstruct\s+\w+\s*:\s*Codable/);
  const scope = nested > -1 ? body.slice(0, nested + 1) : body;
  return [...scope.matchAll(/^\s*var\s+([A-Za-z_][A-Za-z0-9_]*)\s*:/gm)].map((x) => x[1]);
}

// A route may issue SEVERAL statements against the same table — /api/exams has both the
// row query and a GROUP BY batch summary. A non-greedy match finds whichever comes
// first, which was the aggregate, so eight real columns looked missing. Take the block
// that accounts for the most of this struct's fields.
function selectList(routeFile, fromTable, fields) {
  const src = readFileSync(join(ROOT, routeFile), "utf8");
  const blocks = [...src.matchAll(new RegExp(`SELECT([\\s\\S]*?)FROM\\s+${fromTable}\\b`, "gi"))].map((m) => m[1]);
  if (blocks.length === 0) return null;
  const score = (b) => fields.filter((f) => new RegExp(`AS\\s+"${f}"`, "i").test(b) || new RegExp(`(^|[\\s,(])${f}([\\s,)]|$)`).test(b)).length;
  return blocks.reduce((best, b) => (score(b) > score(best) ? b : best), blocks[0]);
}

const CASES = [
  { struct: "ServerExam",   route: "app/api/exams/route.js",      table: "exams",              envelope: "exams" },
  { struct: "ServerPeriod", route: "app/api/extra-duty/route.js", table: "extra_duty_periods", envelope: "periods" },
];

const problems = [];
let checked = 0;

for (const c of CASES) {
  const fields = fieldsOf(c.struct);
  if (!fields || fields.length === 0) { problems.push(`could not parse fields from Swift struct ${c.struct} — the parser is broken or the struct was renamed`); continue; }
  const list = selectList(c.route, c.table, fields);
  if (!list) { problems.push(`could not find a SELECT ... FROM ${c.table} in ${c.route}`); continue; }

  for (const f of fields) {
    // Produced either as an explicit alias AS "field", or as a bare selected column.
    const aliased = new RegExp(`AS\\s+"${f}"`, "i").test(list);
    const bare = new RegExp(`(^|[\\s,(])${f}([\\s,)]|$)`).test(list);
    if (!aliased && !bare) problems.push(`${c.route} no longer produces "${f}", which ${c.struct} decodes — cloud sync breaks on every installed build`);
    checked++;
  }

  const src = readFileSync(join(ROOT, c.route), "utf8");
  if (!new RegExp(`Response\\.json\\(\\s*\\{\\s*${c.envelope}\\b`).test(src)) {
    problems.push(`${c.route} no longer wraps its rows in { ${c.envelope}: ... }, which the Swift envelope requires`);
  }
}

// /api/store is a raw key/value read: the app needs `value` on the response.
const storeSrc = readFileSync(join(ROOT, "app/api/store/route.js"), "utf8");
if (!/Response\.json\(\s*\{\s*key,\s*value:/.test(storeSrc)) {
  problems.push(`app/api/store/route.js GET no longer returns { key, value } — pullKV/pushKV in CloudSyncService depend on it`);
}
checked++;

if (checked < 20) fail(`only ${checked} contract fields were compared — the parser is not seeing the structs`);
problems.length
  ? fail(`${problems.length} native-contract break(s) between this API and neurorvu-ios`, problems)
  : pass(`all ${checked} fields the iOS client decodes are still produced by the routes`);
