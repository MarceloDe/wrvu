// Shared Postgres helpers for the migration checks.
//
// Replay runs against an EPHEMERAL LOCAL POSTGRES, not a Neon branch. Neon branch
// creation is unavailable here — no neonctl, no API key (goals/DECISIONS.md). A real
// Postgres 17 in Docker is not a mock: the question replay answers is "do these
// migration files produce this schema", which is a property of the SQL, not of Neon.
import { execSync, spawnSync } from "node:child_process";
import { pending } from "./_lib.mjs";

const PSQL = ["/opt/homebrew/opt/postgresql@16/bin/psql", "psql"].find((p) => {
  try { execSync(`command -v ${p}`, { stdio: "ignore" }); return true; } catch { return false; }
});

export function haveDocker() {
  try { execSync("docker info", { stdio: "ignore" }); return true; } catch { return false; }
}

// `docker info` succeeding does NOT mean a container can start. Docker Desktop's VM
// disk fills long before the host does, and `docker run` then exits 125. An earlier
// version let that surface as a raw execSync stack trace — the same INV-NO-RAW-ERRORS
// failure we forbid in the app, in the code that is supposed to police it. The reason
// is now carried on the error so callers can report it instead of a backtrace.
export class EphemeralUnavailable extends Error {
  constructor(reason) { super(reason); this.name = "EphemeralUnavailable"; }
}

export function startEphemeral(name = `pgtmp${process.pid}`, port = 55433 + (process.pid % 500)) {
  execSync(`docker rm -f ${name}`, { stdio: "ignore" });
  const run = spawnSync("docker", ["run", "-d", "--name", name, "-e", "POSTGRES_PASSWORD=x", "-p", `${port}:5432`, "postgres:17-alpine"], { encoding: "utf8" });
  if (run.status !== 0) {
    const err = (run.stderr || run.stdout || "").trim();
    if (/no space left on device/i.test(err)) {
      throw new EphemeralUnavailable(`Docker cannot start a container: its virtual disk is full. Reclaim space in Docker Desktop (the host disk is not the constraint). Raw: ${err.split("\n").pop()}`);
    }
    if (/port is already allocated|address already in use/i.test(err)) {
      throw new EphemeralUnavailable(`port ${port} is already in use by another container. Raw: ${err.split("\n").pop()}`);
    }
    throw new EphemeralUnavailable(`docker run exited ${run.status}: ${err.split("\n").slice(-2).join(" ")}`);
  }
  for (let i = 0; i < 60; i++) {
    try { execSync(`docker exec ${name} pg_isready -U postgres`, { stdio: "ignore" }); break; } catch { execSync("sleep 1"); }
    if (i === 59) throw new Error("ephemeral postgres never became ready");
  }
  return { name, url: `postgres://postgres:x@localhost:${port}/postgres` };
}

// Every caller wants the same thing when the container will not start: an honest
// PENDING that names the fix, never a backtrace. Kept here so a new replay check
// cannot forget it.
export function startEphemeralOrPend(name, port) {
  try { return startEphemeral(name, port); }
  catch (e) {
    if (e instanceof EphemeralUnavailable) {
      pending(`the ephemeral Postgres could not start — ${e.message}`,
              "Docker can start a postgres:17-alpine container again");
    }
    throw e;
  }
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
