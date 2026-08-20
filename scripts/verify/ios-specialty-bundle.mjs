#!/usr/bin/env node
// The iOS app bundles a copy of the specialty tags. This checks it still matches.
//
// neurorvu-ios/NeuroRVU/Reference/Resources/code-specialties.json exists so a phone that
// has never reached the network ranks search the way the PWA does. It is a COPY of
// reference.code_specialties, and a copy with no check on it is the thing this project
// has already paid for five times over (D28 collapsed five live copies of the reference
// data into one for exactly this reason).
//
// Staleness here is quiet and survivable, which is what makes it worth a check: the
// network sync delivers fresh tags on a new release, and backfillSpecialtyTagsIfNeeded
// stands down once any tag exists — so a stale bundle only affects a fresh install that
// has not synced yet, and it degrades to slightly wrong ORDERING rather than to wrong
// numbers. Nothing would ever fail. It would just quietly stop being true.
//
// PENDING, not FAIL, when the iOS checkout or the database is absent: this runs from the
// PWA repo, and the iOS tree is not there in every environment.
import { pass, fail, pending } from "./_lib.mjs";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const BUNDLE = resolve(
  process.cwd(), "..", "neurorvu-ios", "NeuroRVU", "Reference", "Resources", "code-specialties.json",
);
if (!existsSync(BUNDLE)) {
  pending("the neurorvu-ios checkout is not beside this repo, so the bundled copy cannot be read",
          "a sibling ../neurorvu-ios working tree");
}

let bundle;
try {
  bundle = JSON.parse(readFileSync(BUNDLE, "utf8"));
} catch (e) {
  fail(`the bundled tag file does not parse (${String(e.message).slice(0, 80)})`, [
    "An unparseable file loads as an empty map on device — ReferenceSeeder.loadSpecialtyTags",
    "returns [:] rather than throwing, so ranking silently degrades to no-preference and",
    "nothing else breaks. That is the right runtime behaviour and the wrong build behaviour.",
  ]);
}

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) pending("no database URL, so the bundled copy cannot be compared", "run with --env-file=.env.local");

const pg = (await import("pg")).default;
const c = new pg.Client({ connectionString: url });
try { await c.connect(); }
catch (e) { pending(`could not connect (${String(e.message).slice(0, 60)})`, "a reachable database"); }

const [v] = (await c.query(
  `select id, source_release, source_sha256 from reference.fee_schedule_versions where is_current`)).rows;
if (!v) fail("no current fee schedule version — the reference schema is not loaded");

const rows = (await c.query(
  `select s.hcpcs, array_agg(s.specialty order by s.specialty) tags
   from reference.code_specialties s where s.version_id = $1
   group by s.hcpcs order by s.hcpcs`, [v.id])).rows;
await c.end();

const live = Object.fromEntries(rows.map((r) => [r.hcpcs, r.tags.join(",")]));
const problems = [];

if (bundle.release !== v.source_release) {
  problems.push(`RELEASE  the bundle says "${bundle.release}", the database is on "${v.source_release}". Regenerate it.`);
}
const shipped = bundle.tags ?? {};
const missing = Object.keys(live).filter((k) => !(k in shipped));
const extra = Object.keys(shipped).filter((k) => !(k in live));
const changed = Object.keys(live).filter((k) => k in shipped && shipped[k] !== live[k]);

if (missing.length) problems.push(`MISSING  ${missing.length} tagged code(s) absent from the bundle, e.g. ${missing.slice(0, 5).join(", ")}`);
if (extra.length) problems.push(`STALE    ${extra.length} code(s) in the bundle carry tags the database no longer has, e.g. ${extra.slice(0, 5).join(", ")}`);
if (changed.length) problems.push(`CHANGED  ${changed.length} code(s) disagree, e.g. ` +
  changed.slice(0, 3).map((k) => `${k}: bundle "${shipped[k]}" vs db "${live[k]}"`).join("; "));

// A bundle that ships zero tags is the failure that looks like success: every code is
// simply untagged, ranking becomes a no-op, and no test that only checks "does it load"
// would notice.
if (Object.keys(shipped).length === 0) {
  problems.push("EMPTY    the bundle carries no tags at all — ranking would be inert on every fresh install");
}

problems.length
  ? fail(`${problems.length} problem(s) between the bundled specialty tags and ${v.source_release}`, [
      ...problems,
      "",
      "Regenerate with the query in this file and commit the result to neurorvu-ios.",
    ])
  : pass(`the bundled specialty tags match ${v.source_release}: ${Object.keys(shipped).length} tagged codes, byte-identical`);
