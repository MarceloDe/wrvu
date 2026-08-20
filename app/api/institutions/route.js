// The user's institutions and their site mappings.
//
// GET is read-only on purpose. A GET that quietly seeds rows is a write disguised as a
// read, and the surprise lands on whoever debugs it at 2am. A user with no institutions
// yet is handled where it belongs — the client falls back to the built-in defaults, so the
// app works for someone who has never opened Settings (INV-SITE-NEVER-FAILS).
//
// PUT replaces the whole set in ONE transaction. The Settings drawer edits institutions,
// their YTD figures and their site mappings together and saves once, so granular CRUD
// would only create windows where the set is half-valid — no default institution, or a
// mapping pointing at an institution that no longer exists.
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
      // examCount comes back so the editor can refuse a removal BEFORE the user saves.
      // The envelope is `{error:{code,correlationId}}` and nothing else by design
      // (INV-NO-RAW-ERRORS), so a 409 cannot explain which institution or how many
      // studies — telling the user up front is both kinder and the only honest option.
      institutions: await sql`
        select i.id, i.name, i.label, i.short_label as "shortLabel", i.color,
               i.ytd_wrvu::float as "ytdWrvu", i.sort_order as "sortOrder", i.is_default as "isDefault",
               i.practice_state as "practiceState", i.address, i.is_primary as "isPrimary",
               count(e.id)::int as "examCount"
        from institutions i left join exams e on e.institution_id = i.id
        group by i.id order by i.sort_order, i.name`,
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


// The set a user must always end up with: at least one institution, and exactly one
// marked default. The default is where an unrecognised site lands, so a set without one
// would drop studies on the floor (INV-SITE-NEVER-FAILS). A partial unique index enforces
// the "at most one" half in the database; this enforces the "at least one" half, which an
// index cannot express.
// "" and "   " are the same as absent. An empty text input must not persist as an empty
// string that later reads as "the user answered" — they skipped (D35).
const blank = (v) => {
  const t = typeof v === "string" ? v.trim() : v;
  return t === "" || t === undefined ? null : t ?? null;
};

function validate(institutions) {
  if (!Array.isArray(institutions) || institutions.length === 0) {
    return "at least one institution is required";
  }
  const names = institutions.map((i) => String(i?.name ?? "").trim());
  if (names.some((n) => !n)) return "every institution needs a name";
  if (new Set(names.map((n) => n.toUpperCase())).size !== names.length) {
    return "institution names must be unique";
  }
  const defaults = institutions.filter((i) => i.isDefault).length;
  if (defaults !== 1) {
    return `exactly one institution must be the default for unmapped sites (got ${defaults})`;
  }
  // At MOST one principal — deliberately not "exactly one". A user who never named a
  // principal institution is normal; a user with no default is broken. Different rules
  // for different flags (N33).
  const primaries = institutions.filter((i) => i.isPrimary).length;
  if (primaries > 1) {
    return `only one institution can be your principal one (got ${primaries})`;
  }
  return null;
}

export const PUT = withErrorEnvelope("/api/institutions", async (req, ctx) => {
  const { userId } = await auth();
  if (!userId) return ctx.fail("unauthorized", 401);

  let body;
  try { body = await req.json(); } catch { return ctx.fail("invalid_json", 400, { message: "body must be JSON" }); }

  const institutions = body?.institutions;
  const invalid = validate(institutions);
  if (invalid) return ctx.fail("validation_failed", 400, { message: invalid });

  const siteOverrides = body?.siteOverrides && typeof body.siteOverrides === "object" ? body.siteOverrides : {};
  const keep = institutions.map((i) => String(i.name).trim());

  try {
    const result = await withTenant(userId, async ({ sql }) => {
      // Refuse rather than reassign. An institution with exams behind it is history, and
      // silently re-pointing 500 studies at a different name to satisfy a delete is a
      // worse outcome than the delete failing with a number the user can act on.
      const orphaning = await sql`
        select i.name, count(e.id)::int as exams
        from institutions i left join exams e on e.institution_id = i.id
        where not (i.name = any(${keep}))
        group by i.name having count(e.id) > 0`;
      if (orphaning.length) {
        return { conflict: orphaning.map((r) => `${r.name} (${r.exams} exams)`).join(", ") };
      }

      await sql`delete from institution_sites where institution_id in (select id from institutions)`;
      await sql`delete from institutions where not (name = any(${keep}))`;

      for (const [idx, i] of institutions.entries()) {
        await sql`
          insert into institutions (user_id, name, label, short_label, color, ytd_wrvu, sort_order,
                                    is_default, practice_state, address, is_primary)
          values (${userId}, ${String(i.name).trim()}, ${String(i.label ?? i.name).trim()},
                  ${String(i.shortLabel ?? i.name).trim()}, ${i.color ?? null},
                  ${Number(i.ytdWrvu) || 0}, ${idx}, ${!!i.isDefault},
                  ${blank(i.practiceState)}, ${blank(i.address)}, ${!!i.isPrimary})
          on conflict (user_id, name) do update set
            label = excluded.label, short_label = excluded.short_label, color = excluded.color,
            ytd_wrvu = excluded.ytd_wrvu, sort_order = excluded.sort_order, is_default = excluded.is_default,
            practice_state = excluded.practice_state, address = excluded.address,
            is_primary = excluded.is_primary`;
      }

      // Patterns are stored uppercased because that is how the classifier looks them up.
      // A mapping naming an institution outside the set is dropped, not an error: the UI
      // cannot produce one, and failing the whole save over it would lose the user's edits.
      const byName = Object.fromEntries((await sql`select id, name from institutions`).map((r) => [r.name, r.id]));
      for (const [pattern, name] of Object.entries(siteOverrides)) {
        const id = byName[String(name).trim()];
        const p = String(pattern).trim().toUpperCase();
        if (!id || !p) continue;
        await sql`insert into institution_sites (user_id, institution_id, pattern) values (${userId}, ${id}, ${p})
                  on conflict do nothing`;
      }
      return { saved: institutions.length };
    });

    if (result.conflict) {
      return ctx.fail("validation_failed", 409, {
        message: `cannot remove an institution that still has exams: ${result.conflict}. Re-map those studies first.`,
      });
    }
    return Response.json({ ok: true, ...result });
  } catch (err) {
    return ctx.fail("storage_unavailable", 503, { cause: err, message: "institutions write failed" });
  }
});
