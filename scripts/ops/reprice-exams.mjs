#!/usr/bin/env node
// N20b — reprice stored exams against the CMS reference.
//
// Every row written before N14 carries whichever app's local table priced it, and the
// two disagreed on 54 of 61 codes. This replaces those figures with resolveValue()'s
// answer and stamps the provenance, so the column stops being a mixture.
//
// THIS CHANGES NUMBERS THE USER HAS ALREADY SEEN AND REPORTED. It is therefore
// dry-run by default and prints the full impact — per code and per tenant — before
// anything is written. --apply is a separate, deliberate act.
//
// Rows already priced by the server are left alone: re-pricing them would be a no-op
// against the same release, and against a NEW release it would silently rewrite history
// that was correct when it was recorded. Only legacy_client rows are touched.
import pg from "pg";
import { join } from "node:path";

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const APPLY = process.argv.includes("--apply");
const urlEnv = arg("--url-env") || "DATABASE_URL_UNPOOLED";
const url = process.env[urlEnv];
if (!url) { console.error(`FAIL  $${urlEnv} is not set`); process.exit(1); }
process.env.DATABASE_URL = url;

const { resolveMany } = await import(join(process.cwd(), "lib/pricing/resolve-value.ts"));

const c = new pg.Client({ connectionString: url });
await c.connect();
try {
  const { rows } = await c.query(
    `select id, user_id, cpt, wrvu::float as wrvu, wrvu_state from exams where wrvu_state = 'legacy_client' order by cpt`);
  if (rows.length === 0) { console.log("  nothing to reprice — no legacy_client rows remain"); process.exit(0); }

  const priced = await resolveMany(rows.map((r) => ({ hcpcs: r.cpt || "" })));

  const byCode = new Map(), byTenant = new Map();
  let changed = 0, unchanged = 0, nowUnpriced = 0, unknown = 0;
  const plan = [];

  rows.forEach((r, i) => {
    const v = priced[i];
    const next = v.workRvu === null ? 0 : v.workRvu;
    const delta = +(next - r.wrvu).toFixed(2);
    plan.push({ id: r.id, next, state: v.state, versionId: v.versionId, delta });
    if (v.state === "unknown_code") unknown++;
    else if (v.workRvu === null) nowUnpriced++;
    if (Math.abs(delta) < 0.005) { unchanged++; return; }
    changed++;
    const k = r.cpt ?? "(null)";
    const e = byCode.get(k) ?? { cpt: k, n: 0, from: r.wrvu, to: next, delta: 0, state: v.state };
    e.n++; e.delta = +(e.delta + delta).toFixed(2); byCode.set(k, e);
    const t = byTenant.get(r.user_id) ?? { n: 0, delta: 0 };
    t.n++; t.delta = +(t.delta + delta).toFixed(2); byTenant.set(r.user_id, t);
  });

  const net = plan.reduce((s, p) => s + p.delta, 0);
  console.log(`  legacy rows          ${rows.length}`);
  console.log(`  wRVU changes         ${changed}   unchanged ${unchanged}`);
  console.log(`  become unpriced      ${nowUnpriced}   unknown code ${unknown}`);
  console.log(`  NET wRVU change      ${net > 0 ? "+" : ""}${net.toFixed(2)}`);
  console.log("\n  by code (largest absolute effect first):");
  [...byCode.values()].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 15)
    .forEach((e) => console.log(`    ${e.cpt.padEnd(7)} ${String(e.n).padStart(4)} exams  ${String(e.from).padStart(5)} -> ${String(e.to).padStart(5)}  net ${e.delta > 0 ? "+" : ""}${e.delta}   ${e.state}`));
  console.log("\n  by tenant (ids hashed — they identify a colleague):");
  const { createHash } = await import("node:crypto");
  [...byTenant.entries()].forEach(([u, t]) =>
    console.log(`    tenant ${createHash("sha256").update(u).digest("hex").slice(0, 8)}  ${t.n} exams  net ${t.delta > 0 ? "+" : ""}${t.delta} wRVU`));

  if (!APPLY) { console.log("\n  DRY RUN — nothing was written. Re-run with --apply to commit."); process.exit(0); }

  await c.query("begin");

  // Durable, precise rollback — and the N20c reconciliation artifact in one table.
  // A Neon branch snapshot would also work, but this records exactly which rows moved
  // and by how much, which is what someone comparing an old report against a new one
  // actually needs. Deliberately NOT granted to app_authenticated: it is operator-only
  // and it is tenant-linked, so the application must not be able to read it.
  await c.query(`
    create table if not exists exams_reprice_log (
      exam_id      uuid        not null,
      old_wrvu     numeric     not null,
      new_wrvu     numeric     not null,
      old_state    text        not null,
      new_state    text        not null,
      release      text        not null,
      applied_at   timestamptz not null default now(),
      primary key (exam_id, applied_at)
    )`);
  await c.query(`revoke all on exams_reprice_log from public`);

  const release = (await c.query(`select source_release from reference.fee_schedule_versions where is_current`)).rows[0].source_release;
  const before = new Map(rows.map((r) => [r.id, r]));
  for (const p of plan) {
    const b = before.get(p.id);
    await c.query(
      `insert into exams_reprice_log (exam_id, old_wrvu, new_wrvu, old_state, new_state, release)
       values ($1,$2,$3,$4,$5,$6)`,
      [p.id, String(b.wrvu), String(p.next), b.wrvu_state, p.state, release]);
    await c.query(`update exams set wrvu = $1, wrvu_state = $2, priced_from = $3 where id = $4`,
                  [String(p.next), p.state, p.versionId, p.id]);
  }
  const left = await c.query(`select count(*)::int n from exams where wrvu_state = 'legacy_client'`);
  if (left.rows[0].n !== 0) throw new Error(`${left.rows[0].n} legacy rows remain after the update`);
  await c.query("commit");
  console.log(`\n  APPLIED: ${plan.length} rows repriced against the current CMS release; 0 legacy rows remain.`);
  console.log(`  every previous value is recorded in exams_reprice_log — reverse with:`);
  console.log(`    update exams e set wrvu = l.old_wrvu, wrvu_state = l.old_state, priced_from = null`);
  console.log(`      from exams_reprice_log l where l.exam_id = e.id;`);
} catch (e) {
  await c.query("rollback").catch(() => {});
  console.error(`FAIL  ${e.message}`);
  process.exit(1);
} finally { await c.end(); }
