// The user's institutions and their site mappings.
//
// Read-only on purpose. A GET that quietly seeds rows is a write disguised as a read, and
// the surprise lands on whoever debugs it at 2am. A user with no institutions yet is
// handled where it belongs — the client falls back to the built-in defaults, so the app
// works for someone who has never opened Settings (INV-SITE-NEVER-FAILS).
//
// Site mappings come back keyed by the UPPERCASED pattern, because that is how the
// classifier looks them up and doing the casing here means neither client has to
// remember to.

import { auth } from "@clerk/nextjs/server";
import { withTenant } from "@/lib/db";
import { withErrorEnvelope } from "@/lib/http/errors";

export const runtime = "nodejs";

export const GET = withErrorEnvelope("/api/institutions", async (req, ctx) => {
  const { userId } = await auth();
  if (!userId) return ctx.fail("unauthorized", 401);

  try {
    const { institutions, sites } = await withTenant(userId, async ({ sql }) => ({
      institutions: await sql`
        select id, name, label, short_label as "shortLabel", color,
               ytd_wrvu::float as "ytdWrvu", sort_order as "sortOrder", is_default as "isDefault"
        from institutions order by sort_order, name`,
      sites: await sql`
        select s.pattern, i.name as institution
        from institution_sites s join institutions i on i.id = s.institution_id`,
    }));

    return Response.json({
      institutions,
      // { "UMBRELLA CLINIC": "JHS" } — a user override beats every built-in pattern.
      siteOverrides: Object.fromEntries(sites.map((s) => [String(s.pattern).toUpperCase(), s.institution])),
    });
  } catch (err) {
    return ctx.fail("storage_unavailable", 503, { cause: err, message: "institutions read failed" });
  }
});
