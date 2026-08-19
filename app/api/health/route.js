// Public health check (whitelisted in middleware).
//
// This endpoint used to report `db: Boolean(process.env.DATABASE_URL)` — that is, it
// checked that a STRING WAS SET and called it a database check. It returned db:true
// during the N04 rotation while nothing had verified that the new role could connect
// at all. A check that cannot fail is worse than no check: it manufactures confidence
// at exactly the moment you need the truth (INV-CHECKS-ACTUALLY-RUN).
//
// It now opens a real connection and reports two things that matter:
//   dbRole       which Postgres role production is actually connecting as
//   rlsEnforced  whether that role is subject to the tenant policies
//
// rlsEnforced guards a specific silent failure. lib/db falls back
// DATABASE_URL -> POSTGRES_URL, and POSTGRES_URL still points at the owner. If the
// Neon integration ever re-syncs and drops the DATABASE_URL override, the app keeps
// working perfectly while every RLS policy goes inert — no error, no symptom. This
// turns that into a red health check.
//
// Neither the connection string nor any secret is exposed; a role name is not one.
import { getUnscopedSql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const body = {
    ok: true,
    db: false,
    dbRole: null,
    rlsEnforced: null,
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    clerk: Boolean(process.env.CLERK_SECRET_KEY),
  };

  try {
    const rows = await getUnscopedSql()`
      select current_user as role,
             (select rolbypassrls from pg_roles where rolname = current_user) as bypass`;
    body.db = true;
    body.dbRole = rows[0].role;
    body.rlsEnforced = rows[0].bypass === false;
  } catch {
    // Deliberately no error detail: this endpoint is public (INV-NO-RAW-ERRORS).
    body.db = false;
  }

  // A connection that bypasses RLS is a control failure on a chart of patient work,
  // not a warning. Say so in the status code, or nobody finds out.
  body.ok = body.db && body.rlsEnforced === true;
  return Response.json(body, { status: body.ok ? 200 : 503 });
}
