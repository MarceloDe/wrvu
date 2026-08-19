#!/usr/bin/env node
// N18 — seed each user's institutions and link their existing exams.
//
// The founder's decision: seed UM and JHS as rows, link the history, keep the text column
// as provenance. Nothing visibly changes — the same names, the same buckets, the same
// numbers — but they are now rows a user can rename, add to, or re-map.
//
// Dry-run by default. Every previous state is recoverable because the exams.institution
// TEXT column is never touched: if the link is wrong, drop institution_id and re-derive.
import pg from "pg";
import { DEFAULT_INSTITUTIONS, classifyInstitution } from "../../lib/analytics/institutions.js";

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const APPLY = process.argv.includes("--apply");
const urlEnv = arg("--url-env") || "DATABASE_URL_UNPOOLED";
const url = process.env[urlEnv];
if (!url) { console.error(`FAIL  $${urlEnv} is not set`); process.exit(1); }

const c = new pg.Client({ connectionString: url });
await c.connect();
try {
  // Every user who has data of any kind, not just exams — a user with settings but no
  // exams yet still needs somewhere for their first upload to land.
  const users = (await c.query(
    `select user_id from exams union select user_id from user_kv union select user_id from extra_duty_periods`
  )).rows.map((r) => r.user_id);
  if (users.length === 0) { console.log("  no users — nothing to seed"); process.exit(0); }

  const existing = (await c.query(`select user_id, name from institutions`)).rows;
  const have = new Set(existing.map((r) => `${r.user_id}|${r.name}`));

  const toCreate = [];
  for (const u of users) {
    DEFAULT_INSTITUTIONS.forEach((inst, idx) => {
      if (!have.has(`${u}|${inst.key}`)) toCreate.push({ user: u, inst, idx });
    });
  }

  // What the exams would link to. The text column already holds a classified value for
  // most rows; anything else goes through the same classifier the UI uses, so the link
  // agrees with what the dashboard has always displayed.
  const exams = (await c.query(
    `select id, user_id, institution, site from exams where institution_id is null`)).rows;
  const plan = exams.map((e) => ({ id: e.id, user: e.user_id,
                                   key: classifyInstitution(e.institution || e.site) }));
  const byKey = plan.reduce((a, p) => ((a[p.key] = (a[p.key] || 0) + 1), a), {});

  console.log(`  users                 ${users.length}`);
  console.log(`  institutions to create ${toCreate.length} (${DEFAULT_INSTITUTIONS.map((i) => i.key).join(", ")} per user)`);
  console.log(`  exams to link          ${plan.length}`);
  console.log(`  by institution         ${Object.entries(byKey).map(([k, n]) => `${k}=${n}`).join("  ") || "none"}`);

  if (!APPLY) { console.log("\n  DRY RUN — nothing written. Re-run with --apply."); process.exit(0); }

  await c.query("begin");
  for (const { user, inst, idx } of toCreate) {
    await c.query(
      `insert into institutions (user_id, name, label, short_label, color, sort_order, is_default)
       values ($1,$2,$3,$4,$5,$6,$7) on conflict (user_id, name) do nothing`,
      [user, inst.key, inst.label, inst.short, inst.color ?? null, idx, !!inst.isDefault]);
  }
  const ids = (await c.query(`select id, user_id, name from institutions`)).rows;
  const idBy = Object.fromEntries(ids.map((r) => [`${r.user_id}|${r.name}`, r.id]));

  let linked = 0;
  for (const p of plan) {
    const instId = idBy[`${p.user}|${p.key}`];
    if (!instId) continue;
    await c.query(`update exams set institution_id = $1 where id = $2`, [instId, p.id]);
    linked++;
  }

  // Every user must end with exactly one default, or an unmapped site has nowhere to go.
  const bad = (await c.query(
    `select user_id, count(*) filter (where is_default)::int d from institutions group by 1 having count(*) filter (where is_default) <> 1`)).rows;
  if (bad.length) throw new Error(`${bad.length} user(s) do not have exactly one default institution`);
  const orphan = (await c.query(`select count(*)::int n from exams where institution_id is null`)).rows[0].n;

  await c.query("commit");
  console.log(`\n  APPLIED: ${toCreate.length} institutions created, ${linked} exams linked, ${orphan} unlinked.`);
  console.log(`  exams.institution (text) untouched — the link can be dropped and re-derived.`);
} catch (e) {
  await c.query("rollback").catch(() => {});
  console.error(`FAIL  ${e.message}`);
  process.exit(1);
} finally { await c.end(); }
