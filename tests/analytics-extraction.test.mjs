// Characterisation tests for the analytics extracted in N06, written to pin the
// behaviour N18 must preserve while generalising UM/JHS to N institutions.
//
// The share arithmetic gets the most attention because it decides how the employer's
// single reported total is attributed, and because the founder chose to generalise it
// proportionally — which only stays correct if the shares keep summing to exactly 1.
import test from "node:test";
import assert from "node:assert/strict";
import { classifyInstitution, INSTITUTIONS } from "../lib/analytics/institutions.js";
import { buildTimeline } from "../lib/analytics/timeline.js";
import { buildAnalytics, buildRange } from "../lib/analytics/tracked.js";

const settings = { monthlyBenchmark: 578, cFTE: 1, umYTD: 0, jhsYTD: 0, ratePerWrvu: 78 };
const day = (date, items) => ({ date, items });
const item = (over = {}) => ({ cpt: "70553", desc: "MRI Brain", mod: "MRI", inst: "UM", count: 1, wrvu: 2.29, ...over });

test("INV-SITE-NEVER-FAILS: an unrecognised site is classified, never rejected", () => {
  for (const raw of ["", null, undefined, "   ", "Some Clinic Nobody Mapped", "12345", "🙂"]) {
    const out = classifyInstitution(raw);
    assert.ok(Object.keys(INSTITUTIONS).includes(out), `${JSON.stringify(raw)} -> ${out} must be a known bucket`);
  }
  assert.equal(classifyInstitution("Some Clinic Nobody Mapped"), "Other");
});

test("site classification keeps its documented priority order", () => {
  assert.equal(classifyInstitution("UM"), "UM", "an exact bucket name passes through");
  assert.equal(classifyInstitution("umhc north"), "UM", "anything starting with 'um' is UM (primary rule)");
  assert.equal(classifyInstitution("Sylvester"), "UM");
  assert.equal(classifyInstitution("Holtz"), "JHS");
  assert.equal(classifyInstitution("JMH"), "JHS");
});

test("reported shares sum to exactly 1, with no drift", () => {
  // 1/3 and 2/3 do not sum to 1 in floating point if computed independently.
  const t = buildTimeline([], [], { ...settings, umYTD: 1, jhsYTD: 2 });
  assert.equal(t.umShare + t.jhsShare, 1, "jhsShare must be 1 - umShare, not jhsYTD/denom");
});

test("with no YTD figures the shares are finite, never NaN", () => {
  const t = buildTimeline([{ key: "2026-07", mo: "Jul 2026", bench: 578, base: 500, extra: 20, pay: 0, cfte: 1 }],
                          [], { ...settings, umYTD: 0, jhsYTD: 0 });
  assert.ok(Number.isFinite(t.umShare), "the || 1 denominator guard must hold");
  assert.ok(Number.isFinite(t.months[0].repUM));
  assert.ok(Number.isFinite(t.months[0].repJHS));
});

test("the reported total is split by share and nothing is lost to rounding", () => {
  const baseline = [{ key: "2026-07", mo: "Jul 2026", bench: 578, base: 900, extra: 100, pay: 0, cfte: 1 }];
  const t = buildTimeline(baseline, [], { ...settings, umYTD: 750, jhsYTD: 250 });
  const m = t.months[0];
  assert.equal(m.total, 1000, "total is base + extra");
  assert.equal(m.repUM, 750);
  assert.equal(m.repJHS, 250);
  assert.equal(m.repUM + m.repJHS, m.total, "the split must account for the whole reported total");
});

test("tracked and reported are separate layers and may disagree", () => {
  const baseline = [{ key: "2026-07", mo: "Jul 2026", bench: 578, base: 500, extra: 0, pay: 0, cfte: 1 }];
  const log = [day("2026-07-10", [item({ count: 100, wrvu: 1 })])];
  const t = buildTimeline(baseline, log, { ...settings, umYTD: 1, jhsYTD: 1 });
  const m = t.months[0];
  assert.equal(m.reported, 500);
  assert.equal(m.tracked, 100);
  assert.equal(Math.round(m.capture), 20, "capture is tracked as a percentage of reported");
});

test("a month present only in the tracked log still appears", () => {
  const t = buildTimeline([], [day("2026-08-03", [item()])], settings);
  assert.equal(t.months.length, 1);
  assert.equal(t.months[0].key, "2026-08");
  assert.equal(t.months[0].reported, 0, "no report for that month means zero reported, not a dropped row");
});

test("buildAnalytics attributes tracked wRVU per institution", () => {
  const log = [day("2026-07-10", [
    item({ inst: "UM", count: 2, wrvu: 1 }),
    item({ inst: "Jackson", count: 3, wrvu: 1 }),
    item({ inst: "Nowhere Imaging", count: 5, wrvu: 1 }),
  ])];
  const a = buildAnalytics(log, settings);
  assert.equal(a.institution.UM.wrvu, 2);
  assert.equal(a.institution.JHS.wrvu, 3);
  assert.equal(a.institution.Other.wrvu, 5, "an unmapped site is counted, not dropped");
  assert.equal(a.ytd.studies, 10);
});

test("buildRange honours the window and the weekly granularity", () => {
  const log = [day("2026-08-03", [item({ count: 1, wrvu: 10 })]),   // Monday
               day("2026-08-05", [item({ count: 1, wrvu: 5 })]),    // same week
               day("2026-09-01", [item({ count: 1, wrvu: 99 })])];  // outside the window
  const r = buildRange(log, settings, "2026-08-01", "2026-08-31", "week");
  assert.equal(r.stats.total, 15, "September must be excluded by the end bound");
  assert.equal(r.rows.length, 1, "both August days fall in the same Monday-keyed week");
  assert.equal(r.rows[0].key, "2026-08-03");
});

test("buildRange percentages are finite when there is nothing to divide by", () => {
  const r = buildRange([], settings, "2026-08-01", "2026-08-31", "month");
  assert.ok(Number.isFinite(r.stats.umPct));
  assert.ok(Number.isFinite(r.stats.avgPerDay));
  assert.ok(Number.isFinite(r.stats.vsBenchPct));
});

// ── N18: the same arithmetic, generalised to N institutions ──────────────────
// Every test above still passes unchanged, which is the real proof: generalising did not
// alter the two-institution result. These add the N cases.
import { sharesFor, buildTimeline as buildTimelineN } from "../lib/analytics/timeline.js";
import { makeClassifier, DEFAULT_INSTITUTIONS } from "../lib/analytics/institutions.js";

const FOUR = [{ key: "A" }, { key: "B" }, { key: "C" }, { key: "Other", isDefault: true }];

test("N-way shares sum to exactly 1, including thirds", () => {
  const s = sharesFor(FOUR, { A: 1, B: 1, C: 1 });
  // 1/3 + 1/3 + 1/3 !== 1 in floating point. The remainder-to-last rule is what fixes it.
  assert.equal(Object.values(s).reduce((a, b) => a + b, 0), 1);
});

test("the default institution never receives part of the reported split", () => {
  const s = sharesFor(FOUR, { A: 5, B: 5, C: 0 });
  assert.equal(s.Other, 0, "unattributed work is not part of what the employer reported");
});

test("N-way with no YTD figures anywhere stays finite", () => {
  const s = sharesFor(FOUR, {});
  for (const [k, v] of Object.entries(s)) assert.ok(Number.isFinite(v), `${k} share is ${v}`);
  assert.equal(Object.values(s).reduce((a, b) => a + b, 0), 1);
});

test("two institutions produce byte-identical numbers to the old scalars", () => {
  const baseline = [{ key: "2026-07", mo: "Jul 2026", bench: 578, base: 900, extra: 100, pay: 0, cfte: 1 }];
  const legacy = buildTimelineN(baseline, [], { ...settings, umYTD: 750, jhsYTD: 250 });
  const generalised = buildTimelineN(baseline, [], {
    ...settings, institutions: DEFAULT_INSTITUTIONS, ytdByInstitution: { UM: 750, JHS: 250 },
  });
  assert.equal(legacy.months[0].repUM, generalised.months[0].repUM);
  assert.equal(legacy.months[0].repJHS, generalised.months[0].repJHS);
  assert.deepEqual(legacy.months[0].reported_by_institution, generalised.months[0].reported_by_institution);
});

test("a user-defined site mapping beats every built-in pattern", () => {
  // "UMBRELLA CLINIC" starts with 'um' and would otherwise be captured by the UM prefix
  // rule. This is the iOS nrv_sites behaviour, which the PWA did not have.
  const classify = makeClassifier(DEFAULT_INSTITUTIONS, { "UMBRELLA CLINIC": "JHS" });
  assert.equal(classify("Umbrella Clinic"), "JHS");
  assert.equal(classify("UMHC North"), "UM", "unmapped sites still follow the built-in rules");
});

test("a fourth institution needs no code change", () => {
  const withLRC = [...DEFAULT_INSTITUTIONS.slice(0, 2),
                   { key: "LRC", match: /lennar|\blrc\b/i },
                   DEFAULT_INSTITUTIONS[2]];
  const classify = makeClassifier(withLRC);
  assert.equal(classify("Lennar Foundation"), "LRC");
  assert.equal(classify("Holtz"), "JHS", "existing institutions keep classifying as before");
  assert.equal(classify("Nowhere"), "Other");
});
