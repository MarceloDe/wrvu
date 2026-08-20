// Code search, ranked by the specialty the user picked during onboarding.
//
// D36: specialty tags RANK. They never restrict. searchCodes returns the SAME SET
// whatever the user chose — only the ORDER changes. That is not a stylistic
// preference. 353 of the 668 codes the price book serves carry no tag at all, so a
// filter would hide more than half the fee schedule, and a "body" radiologist would
// be unable to log the head CT
// they just read. Ranking helps; filtering loses work that was actually done.
//
// Search runs over the union of two sources, which is why this is more than a sort:
//
//   price book (/api/reference/codes)  all 668 professional-component codes, the CMS
//                                      descriptor and modality, the tags, the wRVU
//   display taxonomy (lib/data/...)    61 codes with a name a radiologist can scan
//                                      ("MRI Brain" rather than "Mri brain stem w/o dye")
//
// The taxonomy wins on presentation; the price book wins on numbers and coverage.
// Before this, both search surfaces read the taxonomy ALONE, so 607 of the 668 codes
// could not be found at all — and the onboarding specialty step, which promises
// "first in search and quick-add", changed nothing anywhere in the app.

/** Onboarding's four choices, mapped onto the tags the reference schema actually carries. */
export const SPECIALTY_TAGS = {
  neuro: ["neuro"],
  body: ["body"],
  both: ["neuro", "body"],
  all: [],            // no preference — every code weighted the same
};

export const wantedTags = (specialty) => SPECIALTY_TAGS[specialty] ?? [];

/**
 * One searchable row per code, taking presentation from the taxonomy where it exists
 * and everything else from the price book.
 *
 * A code in the taxonomy but not the price book still appears, unpriced. That is the
 * INV-SITE-NEVER-FAILS reflex applied to codes: a missing price is a thing to show as
 * missing, not a reason to make the code unfindable.
 */
export function mergeCatalog(book, taxonomy) {
  const byCpt = new Map();
  for (const c of Object.values(book?.byCpt ?? {})) {
    byCpt.set(c.cpt, {
      cpt: c.cpt,
      desc: c.descriptor || c.cpt,
      mod: c.modality || "",
      region: "",
      con: "",
      wrvu: c.workRvu,
      specialties: c.specialties ?? [],
      named: false,             // CMS descriptor, not a curated name
    });
  }
  for (const t of taxonomy ?? []) {
    const cpt = String(t.cpt).replace("+", "");
    const base = byCpt.get(cpt);
    byCpt.set(cpt, {
      cpt,
      desc: t.desc,             // curated name wins
      mod: t.mod || base?.mod || "",
      region: t.region || "",
      con: t.con || "",
      wrvu: base ? base.wrvu : null,   // never from the taxonomy: it carries no price
      specialties: base?.specialties ?? [],
      named: true,
    });
  }
  return [...byCpt.values()];
}

const matches = (c, t) =>
  !t ||
  c.cpt.includes(t) ||
  c.desc.toLowerCase().includes(t) ||
  c.region.toLowerCase().includes(t) ||
  c.mod.toLowerCase() === t;

/**
 * Higher sorts first. Specialty contributes ONE term among several and can never
 * reach zero — an untagged code scores lower than a tagged one and still ranks.
 */
export function scoreOf(c, t, want) {
  let s = 0;
  if (t && c.cpt === t) s += 1000;                                        // typed the code
  else if (t && c.cpt.startsWith(t)) s += 500;                            // typing it
  if (want.length && c.specialties.some((x) => want.includes(x))) s += 100;  // their specialty
  if (c.named) s += 10;                                                   // has a readable name
  return s;
}

/**
 * @returns {Array} matching codes, best first. `limit` truncates the RESULT, never the
 * search: the ranking has already decided what the top of the list is, so the cheapest
 * way to make specialty matter is to make sure it runs before the slice, not after.
 */
export function searchCodes(query, { catalog = [], specialty = "all", limit = 0 } = {}) {
  const t = String(query ?? "").trim().toLowerCase();
  const want = wantedTags(specialty);
  const hits = catalog.filter((c) => matches(c, t));
  hits.sort((a, b) => scoreOf(b, t, want) - scoreOf(a, t, want) || a.cpt.localeCompare(b.cpt));
  return limit > 0 ? hits.slice(0, limit) : hits;
}
