// Shared Postgres helpers for the migration checks.
//
// Replay runs against an EPHEMERAL LOCAL POSTGRES, not a Neon branch. Neon branch
// creation is unavailable here — no neonctl, no API key (goals/DECISIONS.md). A real
// Postgres 17 in Docker is not a mock: the question replay answers is "do these
// migration files produce this schema", which is a property of the SQL, not of Neon.
import { execSync, spawnSync } from "node:child_process";

const PSQL = ["/opt/homebrew/opt/postgresql@16/bin/psql", "psql"].find((p) => {
  try { execSync(`command -v ${p}`, { stdio: "ignore" }); return true; } catch { return false; }
});

export function haveDocker() {
  try { execSync("docker info", { stdio: "ignore" }); return true; } catch { return false; }
}

export function startEphemeral(name = `pgtmp${process.pid}`, port = 55433 + (process.pid % 500)) {
  execSync(`docker rm -f ${name}`, { stdio: "ignore" });
  execSync(`docker run -d --name ${name} -e POSTGRES_PASSWORD=x -p ${port}:5432 postgres:17-alpine`, { stdio: "ignore" });
  for (let i = 0; i < 60; i++) {
    try { execSync(`docker exec ${name} pg_isready -U postgres`, { stdio: "ignore" }); break; } catch { execSync("sleep 1"); }
    if (i === 59) throw new Error("ephemeral postgres never became ready");
  }
  return { name, url: `postgres://postgres:x@localhost:${port}/postgres` };
}

export function stopEphemeral(name) { execSync(`docker rm -f ${name}`, { stdio: "ignore" }); }

export function applySql(url, file) {
  const r = spawnSync(PSQL, ["-d", url, "-v", "ON_ERROR_STOP=1", "-q", "-f", file], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`applying ${file} failed:\n${r.stderr || r.stdout}`);
}

// A comparable, order-stable description of a schema. Deliberately excludes
// _migrations: it is history, not schema, and including it would make the
// baseline diff fail the moment the migrator has ever run.
const SNAPSHOT_SQL = `
select json_build_object(
  'columns', (select coalesce(json_agg(x order by x->>'t', x->>'c'),'[]'::json) from (
      select json_build_object('t',table_name,'c',column_name,'d',data_type,
                               'n',is_nullable,'df',column_default) x
      from information_schema.columns
      where table_schema='public' and table_name <> '_migrations') s),
  'indexes', (select coalesce(json_agg(i order by i),'[]'::json) from (
      select indexdef i from pg_indexes
      where schemaname='public' and tablename <> '_migrations') s2)
)`;

export async function snapshot(url) {
  const { neon } = await import("@neondatabase/serverless");
  if (/neon\.tech/.test(url)) {
    const sql = neon(url);
    const r = await sql(SNAPSHOT_SQL);
    return r[0].json_build_object;
  }
  const r = spawnSync(PSQL, ["-d", url, "-tAc", SNAPSHOT_SQL], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return JSON.parse(r.stdout);
}

export function diff(left, right, leftName = "left", rightName = "right") {
  const out = [];
  const key = (o) => JSON.stringify(o);
  for (const [kind, l, r] of [["column", left.columns, right.columns], ["index", left.indexes, right.indexes]]) {
    const L = new Set(l.map(key)), R = new Set(r.map(key));
    for (const x of L) if (!R.has(x)) out.push(`${kind} only in ${leftName}: ${x}`);
    for (const x of R) if (!L.has(x)) out.push(`${kind} only in ${rightName}: ${x}`);
  }
  return out;
}
