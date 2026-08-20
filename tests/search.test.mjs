// D36 under test: specialty ranks, and it must never restrict.
//
// The assertion that matters is setEquality across all four specialty settings. A
// filter implementation passes every "neuro user sees neuro codes first" test ever
// written; only comparing the SETS catches it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { searchCodes, mergeCatalog, scoreOf, wantedTags, SPECIALTY_TAGS } from "../lib/analytics/search.js";

// A price book shaped like /api/reference/codes returns it: tagged, untagged, unpriced.
const book = {
  byCpt: {
    "70450": { cpt: "70450", descriptor: "Ct head/brain w/o dye", modality: "CT", workRvu: 0.85, specialties: ["neuro"] },
    "70551": { cpt: "70551", descriptor: "Mri brain stem w/o dye", modality: "MRI", workRvu: 1.48, specialties: ["neuro"] },
    "74177": { cpt: "74177", descriptor: "Ct abd & pelv w/dye", modality: "CT", workRvu: 1.82, specialties: ["body"] },
    "73721": { cpt: "73721", descriptor: "Mri jnt of lwr extre w/o dye", modality: "MRI", workRvu: 1.35, specialties: ["msk"] },
    "76942": { cpt: "76942", descriptor: "Echo guide for biopsy", modality: "US", workRvu: 0.67, specialties: [] },
    "99999": { cpt: "99999", descriptor: "Unlisted procedure", modality: "", workRvu: null, specialties: [] },
  },
};
const taxonomy = [
  { cpt: "70450", mod: "CT", region: "Head/Brain", desc: "CT Head/Brain", con: "W/O" },
  { cpt: "70551", mod: "MRI", region: "Head/Brain", desc: "MRI Brain", con: "W/O" },
  { cpt: "+70496", mod: "CTA", region: "Head/Brain", desc: "CTA Head", con: "W" },
];
const catalog = mergeCatalog(book, taxonomy);
const ALL = ["neuro", "body", "both", "all"];

test("every specialty returns the same set — only the order differs", () => {
  const setFor = (s) => searchCodes("", { catalog, specialty: s }).map((c) => c.cpt).sort().join(",");
  const base = setFor("all");
  for (const s of ALL) {
    assert.equal(setFor(s), base, `specialty "${s}" changed WHICH codes are reachable, not just their order`);
  }
  // And the order genuinely does differ, or the ranking is decorative.
  const neuroFirst = searchCodes("", { catalog, specialty: "neuro" }).map((c) => c.cpt);
  const bodyFirst = searchCodes("", { catalog, specialty: "body" }).map((c) => c.cpt);
  assert.notDeepEqual(neuroFirst, bodyFirst, "specialty changed nothing at all");
});

test("an untagged code is never hidden, at any setting", () => {
  // 476 of 828 real codes are untagged. If any setting drops them, most of the fee
  // schedule becomes unreachable.
  for (const s of ALL) {
    const cpts = searchCodes("", { catalog, specialty: s }).map((c) => c.cpt);
    assert.ok(cpts.includes("76942"), `untagged code vanished at specialty "${s}"`);
    assert.ok(cpts.includes("99999"), `untagged unpriced code vanished at specialty "${s}"`);
  }
});

test("a body radiologist can still find and log a head CT", () => {
  // The exact scenario a filter would break.
  const r = searchCodes("70450", { catalog, specialty: "body" });
  assert.equal(r[0].cpt, "70450", "typing the code must put it first regardless of specialty");
});

test("the chosen specialty ranks ahead of the others", () => {
  const neuro = searchCodes("", { catalog, specialty: "neuro" }).map((c) => c.cpt);
  const body = searchCodes("", { catalog, specialty: "body" }).map((c) => c.cpt);
  assert.ok(neuro.indexOf("70450") < neuro.indexOf("74177"), "neuro user: neuro code should outrank body code");
  assert.ok(body.indexOf("74177") < body.indexOf("70450"), "body user: body code should outrank neuro code");
  // "both" lifts each of them above the untagged rows without ordering one over the other.
  const both = searchCodes("", { catalog, specialty: "both" }).map((c) => c.cpt);
  assert.ok(both.indexOf("70450") < both.indexOf("76942"));
  assert.ok(both.indexOf("74177") < both.indexOf("76942"));
});

test("an exact code beats specialty, and a prefix beats a description match", () => {
  assert.ok(scoreOf({ cpt: "74177", specialties: [], named: false }, "74177", ["neuro"]) >
            scoreOf({ cpt: "70450", specialties: ["neuro"], named: true }, "74177", ["neuro"]),
            "typing a code must win over the specialty preference");
  assert.ok(scoreOf({ cpt: "70450", specialties: [], named: false }, "704", []) >
            scoreOf({ cpt: "99999", specialties: [], named: true }, "704", []));
});

test("the catalog is the whole price book, not the 61-code taxonomy", () => {
  // The regression this pins: both search surfaces used to read the taxonomy alone,
  // so 767 of 828 codes could not be found by any query.
  assert.equal(catalog.length, 7, "6 priced codes + the taxonomy-only add-on");
  assert.ok(catalog.some((c) => c.cpt === "74177"), "a code absent from the neuro taxonomy must still be searchable");
});

test("presentation comes from the taxonomy, numbers from the price book", () => {
  const brain = catalog.find((c) => c.cpt === "70551");
  assert.equal(brain.desc, "MRI Brain", "the curated name must win over the CMS descriptor");
  assert.equal(brain.wrvu, 1.48, "the wRVU must come from the price book");
  assert.deepEqual(brain.specialties, ["neuro"], "tags survive the merge or ranking has nothing to read");

  const cms = catalog.find((c) => c.cpt === "74177");
  assert.equal(cms.desc, "Ct abd & pelv w/dye", "a code with no curated name still shows the CMS descriptor");
});

test("a taxonomy code with no CMS price is searchable and unpriced, not missing", () => {
  const addon = catalog.find((c) => c.cpt === "70496");
  assert.ok(addon, "the + prefix must be stripped so the code matches the price book key");
  assert.equal(addon.wrvu, null, "null, never 0 — the client must be able to say 'not priced'");
});

test("an unknown specialty falls back to no preference rather than throwing", () => {
  assert.deepEqual(wantedTags("gastroenterology"), []);
  assert.deepEqual(wantedTags(undefined), []);
  const r = searchCodes("", { catalog, specialty: "gastroenterology" });
  assert.equal(r.length, catalog.length, "an unrecognised specialty must not empty the results");
});

test("limit truncates the ranked list, so specialty decides what survives the slice", () => {
  const top2 = searchCodes("", { catalog, specialty: "body", limit: 2 });
  assert.equal(top2.length, 2);
  assert.ok(top2.some((c) => c.cpt === "74177"), "the body code must survive a 2-row cut for a body user");
});

test("the four onboarding choices are exactly the four the app offers", () => {
  assert.deepEqual(Object.keys(SPECIALTY_TAGS).sort(), ["all", "body", "both", "neuro"]);
});

// The production crash this module also fixes.
//
// Both search dropdowns rendered `c.wrvu.toFixed(2)` over the DISPLAY TAXONOMY, which
// carries no price at all — so the first result of any query threw TypeError: Cannot
// read properties of undefined (reading 'toFixed') and took the whole page down.
// Reproduced live on fella.cc on 2026-08-20 by typing a CPT into quick-add.
test("every search result carries a renderable wRVU — number or null, never undefined", () => {
  for (const q of ["", "70450", "ct", "mri", "brain", "9"]) {
    for (const c of searchCodes(q, { catalog })) {
      assert.notEqual(c.wrvu, undefined,
        `'${c.cpt}' has an undefined wrvu for query '${q}' — .toFixed() on it is the crash`);
      assert.ok(c.wrvu === null || Number.isFinite(c.wrvu), `'${c.cpt}' wrvu is neither null nor finite`);
    }
  }
});

test("a taxonomy-only code reaches the UI as null, so it renders as unpriced", () => {
  // 70496 is in the taxonomy and absent from this price book. The old code would have
  // thrown on it; the rule is null, never 0 (INV-MONEY-ONE-PATH).
  const addon = searchCodes("70496", { catalog })[0];
  assert.equal(addon.cpt, "70496");
  assert.equal(addon.wrvu, null);
});
