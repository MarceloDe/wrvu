#!/usr/bin/env node
// Load reference/rvu2026a.slim.jsonl into the reference schema.
//
// Idempotent on source_sha256: re-running with the same CMS release is a no-op rather
// than a duplicate. Runs as the OWNER — app_rls holds SELECT only, which is the point.
// The connection string is named by --url-env and never passed in argv.
import pg from "pg";
import { readFileSync } from "node:fs";

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const urlEnv = arg("--url-env") || "DATABASE_URL_UNPOOLED";
const url = process.env[urlEnv];
if (!url) { console.error(`FAIL  $${urlEnv} is not set. Run with --env-file=.env.local`); process.exit(1); }

const manifest = JSON.parse(readFileSync("reference/manifest.json", "utf8"));
const rows = readFileSync("reference/rvu2026a.slim.jsonl", "utf8").split("\n").filter(Boolean).map(JSON.parse);
if (rows.length !== manifest.rows) { console.error(`FAIL  manifest says ${manifest.rows} rows, file has ${rows.length}`); process.exit(1); }

const c = new pg.Client({ connectionString: url });
await c.connect();
try {
  await c.query("begin");

  const existing = await c.query(
    `select id, is_current from reference.fee_schedule_versions where source_release = $1 and source_sha256 = $2`,
    [manifest.source_release, manifest.source_sha256]);
  if (existing.rowCount) {
    console.log(`  already loaded: ${manifest.source_release} ${manifest.source_sha256.slice(0, 12)}… (current=${existing.rows[0].is_current})`);
    await c.query("commit");
    process.exit(0);
  }

  const v = await c.query(
    `insert into reference.fee_schedule_versions
       (source_release, source_file, source_url, source_year, source_sha256, slim_sha256, conversion_factor)
     values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [manifest.source_release, manifest.source_file, manifest.source_url, manifest.source_year,
     manifest.source_sha256, manifest.slim_sha256, manifest.conversion_factor]);
  const versionId = v.rows[0].id;

  // procedure_codes: one row per HCPCS. Descriptor comes from whichever row carries one.
  const byCode = new Map();
  for (const r of rows) if (!byCode.has(r.hcpcs)) byCode.set(r.hcpcs, r);
  const codes = [...byCode.values()];
  for (let i = 0; i < codes.length; i += 500) {
    const chunk = codes.slice(i, i + 500);
    const vals = chunk.map((_, j) => `($1,$${j * 5 + 2},$${j * 5 + 3},$${j * 5 + 4},$${j * 5 + 5},$${j * 5 + 6})`).join(",");
    await c.query(
      `insert into reference.procedure_codes (version_id, hcpcs, descriptor, modality, body_region, contrast_status) values ${vals}`,
      [versionId, ...chunk.flatMap((r) => [r.hcpcs, r.descriptor, r.modality, r.body_region, r.contrast_status])]);
  }

  for (let i = 0; i < rows.length; i += 300) {
    const chunk = rows.slice(i, i + 300);
    const vals = chunk.map((_, j) => {
      const b = j * 10 + 2;
      return `($1,$${b},$${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9})`;
    }).join(",");
    await c.query(
      `insert into reference.code_rvus
         (version_id, hcpcs, modifier, work_rvu, price_state, status_code, pctc_indicator,
          global_days, facility_pe_rvu, non_facility_pe_rvu, malpractice_rvu) values ${vals}`,
      [versionId, ...chunk.flatMap((r) => [r.hcpcs, r.modifier, r.work_rvu, r.price_state, r.status_code,
                                           r.pctc_indicator, r.global_days, r.facility_pe_rvu,
                                           r.non_facility_pe_rvu, r.malpractice_rvu])]);
  }

  await c.query(`update reference.fee_schedule_versions set is_current = false where is_current`);
  await c.query(`update reference.fee_schedule_versions set is_current = true where id = $1`, [versionId]);

  const n = await c.query(`select count(*)::int n from reference.code_rvus where version_id = $1`, [versionId]);
  const m = await c.query(`select count(*)::int n from reference.procedure_codes where version_id = $1`, [versionId]);
  if (n.rows[0].n !== rows.length) throw new Error(`inserted ${n.rows[0].n} rvu rows, expected ${rows.length}`);

  await c.query("commit");
  console.log(`  loaded ${manifest.source_release}: ${m.rows[0].n} codes, ${n.rows[0].n} (hcpcs,modifier) rows — now current`);
} catch (e) {
  await c.query("rollback").catch(() => {});
  console.error(`FAIL  ${e.message}`);
  process.exit(1);
} finally { await c.end(); }
