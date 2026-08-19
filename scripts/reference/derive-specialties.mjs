#!/usr/bin/env node
// Derive specialty tags for the current release. Re-runnable and idempotent.
//
// Rules only, no hand-typed lists: a new CMS extract must not arrive untagged, and a
// hand-curated 828-row mapping is exactly the kind of artifact that drifts and then
// quietly disagrees with the data — this codebase has already paid for that lesson twice.
//
// Untagged is a normal, correct outcome. 475 of the 828 codes carry body_region 'other',
// and tags only RANK (D36), so an untagged code is merely unboosted, never hidden.
import pg from "pg";

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const urlEnv = arg("--url-env") || "DATABASE_URL_UNPOOLED";
const url = process.env[urlEnv];
if (!url) { console.error(`FAIL  $${urlEnv} is not set`); process.exit(1); }

// body_region -> specialties. A code may carry more than one; ordering is the consumer's
// problem, not the tag's.
const BY_REGION = {
  head: ["neuro"], neck: ["neuro"], spine: ["neuro"],
  abdomen: ["body"], chest: ["body"], pelvis: ["body"],
  upper_extremity: ["msk"], lower_extremity: ["msk"],
  breast: ["breast"], cardiac: ["cardiac"], vascular: ["vascular"],
  // 'other' and 'whole_body' are deliberately unmapped: guessing here would tag 475
  // codes on no evidence, which is worse than leaving them unranked.
};

const c = new pg.Client({ connectionString: url });
await c.connect();
try {
  const [{ id: versionId, source_release }] = (await c.query(
    `select id, source_release from reference.fee_schedule_versions where is_current`)).rows;
  if (!versionId) { console.error("FAIL  no current fee schedule version"); process.exit(1); }

  const codes = (await c.query(
    `select hcpcs, body_region, modality from reference.procedure_codes where version_id = $1`,
    [versionId])).rows;
  if (codes.length === 0) { console.error("FAIL  the release has no procedure codes"); process.exit(1); }

  await c.query("begin");
  await c.query(`delete from reference.code_specialties where version_id = $1 and source = 'derived'`, [versionId]);

  const rows = [];
  for (const k of codes) {
    for (const s of BY_REGION[k.body_region] ?? []) rows.push([k.hcpcs, s]);
  }
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const vals = chunk.map((_, j) => `($1,$${j * 2 + 2},$${j * 2 + 3},'derived')`).join(",");
    await c.query(
      `insert into reference.code_specialties (version_id, hcpcs, specialty, source) values ${vals}
       on conflict do nothing`,
      [versionId, ...chunk.flat()]);
  }
  await c.query("commit");

  const summary = (await c.query(
    `select specialty, count(*)::int n from reference.code_specialties
     where version_id = $1 group by 1 order by 2 desc`, [versionId])).rows;
  const tagged = (await c.query(
    `select count(distinct hcpcs)::int n from reference.code_specialties where version_id = $1`, [versionId])).rows[0].n;
  console.log(`  release ${source_release}: ${tagged} of ${codes.length} codes tagged`);
  console.log(`  ${summary.map((s) => `${s.specialty}=${s.n}`).join("  ")}`);
  console.log(`  ${codes.length - tagged} untagged — unranked, never hidden (D36)`);
} catch (e) {
  await c.query("rollback").catch(() => {});
  console.error(`FAIL  ${e.message}`);
  process.exit(1);
} finally { await c.end(); }
