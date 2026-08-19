// The price book: what every code is worth, from the one place that knows.
//
// This exists so the PWA stops shipping its own table. It carried 61 codes that
// disagreed with CMS on 54 of them, duplicated a second time inline in NeuroRVU.jsx.
// The display taxonomy (region, modality, the readable exam name) stays in the client
// because it is presentation; the numbers come from here.
//
// Cached for an hour: a fee schedule version is immutable, and a new release arrives by
// loading a new version and flipping is_current, which changes the ETag.

import { auth } from "@clerk/nextjs/server";
import { getUnscopedSql } from "@/lib/db";
import { withErrorEnvelope } from "@/lib/http/errors";

export const runtime = "nodejs";

export const GET = withErrorEnvelope("/api/reference/codes", async (req, ctx) => {
  const { userId } = await auth();
  if (!userId) return ctx.fail("unauthorized", 401);

  try {
    const sql = getUnscopedSql();
    const rows = await sql`
      select r.hcpcs, r.work_rvu, r.price_state, r.status_code, c.descriptor, c.modality,
             v.source_release, v.conversion_factor
      from reference.code_rvus r
      join reference.fee_schedule_versions v on v.id = r.version_id and v.is_current
      left join reference.procedure_codes c on c.version_id = r.version_id and c.hcpcs = r.hcpcs
      where r.modifier = '26'
      order by r.hcpcs`;

    if (rows.length === 0) {
      // Reachable but empty is a real failure, not an empty price book: silently
      // returning {} would make every study in the UI look unpriced.
      return ctx.fail("reference_not_loaded", 503, { message: "the reference schema holds no codes" });
    }

    const release = rows[0].source_release;
    const body = {
      release,
      conversionFactor: Number(rows[0].conversion_factor),
      codes: rows.map((r) => ({
        cpt: r.hcpcs,
        // null, never 0, when there is no national value — the client must be able to
        // say "not priced" rather than render a zero it cannot explain.
        workRvu: r.work_rvu === null ? null : Number(r.work_rvu),
        priceState: r.price_state,
        statusCode: r.status_code,
        descriptor: r.descriptor,
        // CMS modality. The client must not guess this: it decides which PPC bucket a
        // study is PAID from, and the old "default to CT" turned every unrecognised
        // study into a paid CT.
        modality: r.modality,
      })),
    };
    return Response.json(body, {
      headers: {
        "Cache-Control": "private, max-age=3600",
        ETag: `"${release}-${rows.length}"`,
      },
    });
  } catch (err) {
    return ctx.fail("reference_unavailable", 503, { cause: err, message: "reference schema read failed" });
  }
});
