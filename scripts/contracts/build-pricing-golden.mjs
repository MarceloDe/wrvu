#!/usr/bin/env node
// Generate the pricing golden vectors — the shared oracle both implementations answer to.
//
// D43 federates the repos, so nothing links the Swift and TypeScript pricing paths at
// build time. INV-PARITY says two independent implementations agreeing on a
// third-party-derived oracle is the only real safety net; this file is that oracle.
//
// Deliberately NOT a hand-picked list of "interesting" codes. A curated sample tests the
// cases whoever curated it already thought of, which are exactly the ones already
// correct. This takes every price_state the release contains, samples deterministically
// within each, and adds the neuro codes the app actually uses most — so the fixture keeps
// covering the awkward states as CMS changes them.
import pg from "pg";
import { writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const url = process.env[arg("--url-env") || "DATABASE_URL_UNPOOLED"];
if (!url) { console.error("FAIL  no database URL"); process.exit(1); }
process.env.DATABASE_URL = url;

const { resolveMany } = await import("../../lib/pricing/resolve-value.ts");

const c = new pg.Client({ connectionString: url });
await c.connect();
const [version] = (await c.query(
  `select source_release, source_sha256 from reference.fee_schedule_versions where is_current`)).rows;

// Deterministic sample: ordered by hcpcs, first N of each state. No randomness, so the
// file only changes when the DATA changes — a fixture that churns is a fixture nobody
// reviews.
const PER_STATE = 12;
const sampled = (await c.query(`
  select hcpcs from (
    select r.hcpcs, r.price_state,
           row_number() over (partition by r.price_state order by r.hcpcs) as rn
    from reference.code_rvus r
    join reference.fee_schedule_versions v on v.id = r.version_id and v.is_current
    -- Every non-TC row, not just '26'. Filtering to '26' silently dropped
    -- no_physician_work from the fixture — a state the client has to handle, and the one
    -- most likely to be mishandled, because it is the only case where 0 IS the answer.
    where r.modifier <> 'TC'
  ) t where rn <= $1 order by hcpcs`, [PER_STATE])).rows.map((r) => r.hcpcs);
await c.end();

// Plus every code the neuro taxonomy ships — the ones a user hits daily.
const taxonomy = [...readFileSync("lib/data/neuro-taxonomy.js", "utf8").matchAll(/cpt:\s*"([^"]+)"/g)]
  .map((m) => m[1].replace("+", ""));

const codes = [...new Set([...sampled, ...taxonomy, "99999"])].sort();   // 99999: unknown
const valuations = await resolveMany(codes.map((h) => ({ hcpcs: h })));

const vectors = valuations.map((v) => ({
  cpt: v.hcpcs,
  workRvu: v.workRvu,          // null, never 0, when there is no national value
  priceState: v.state,
  modality: v.modality,
}));
const byState = vectors.reduce((a, v) => ((a[v.priceState] = (a[v.priceState] || 0) + 1), a), {});

const body = JSON.stringify({
  release: version.source_release,
  sourceSha256: version.source_sha256,
  generatedBy: "scripts/contracts/build-pricing-golden.mjs",
  note: "Shared oracle for INV-PARITY. The Swift and TypeScript pricing paths must both reproduce every vector.",
  vectors,
}, null, 2) + "\n";
writeFileSync("contracts/pricing-golden.json", body);

console.log(`  release   ${version.source_release}`);
console.log(`  vectors   ${vectors.length}`);
console.log(`  states    ${Object.entries(byState).map(([k, n]) => `${k}=${n}`).join("  ")}`);
console.log(`  sha256    ${createHash("sha256").update(body).digest("hex").slice(0, 16)}…`);
