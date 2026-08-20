// N06d — the extra-duty pay arithmetic, now that it is a module and not 40 lines inside
// an 1,800-line component. These figures are money the user is actually owed.
import test from "node:test";
import assert from "node:assert/strict";
import { PPC_BUCKET, bucketCounts, buildExtraDuty } from "../lib/analytics/extra-duty.js";

test("an unrecognised modality is not paid", () => {
  // The regression this guards: every call site used to default an unknown modality to
  // "CT" before it reached here, so nothing was ever unrecognised and every unknown
  // study was paid at the CT rate.
  assert.equal(PPC_BUCKET("US"), "other");
  assert.equal(PPC_BUCKET("NM"), "other");
  assert.equal(PPC_BUCKET(""), "other");
  assert.equal(PPC_BUCKET(undefined), "other");
  assert.equal(PPC_BUCKET("Add-on"), "other");
});

test("modality families map to their pay bucket", () => {
  for (const m of ["MRI", "MRA", "mr"]) assert.equal(PPC_BUCKET(m), "mri", m);
  for (const m of ["CT", "CTA", "ct"]) assert.equal(PPC_BUCKET(m), "ct", m);
  for (const m of ["XR", "CR", "DX", "X-RAY", "XRAY", "RADIOGRAPH"]) assert.equal(PPC_BUCKET(m), "xr", m);
});

test("bucketCounts counts studies, not rows", () => {
  const c = bucketCounts([
    { mod: "MRI", count: 3 }, { mod: "CT", count: 2 }, { mod: "XR" }, { mod: "US", count: 9 },
  ]);
  assert.deepEqual(c, { mri: 3, ct: 2, xr: 1, other: 9 });
});

test("periods outside the range are excluded, and dollars are the frozen snapshot", () => {
  const periods = [
    { bundleDate: "2026-01-05", amount: 100, payModel: "per_diem", examCount: 0 },
    { bundleDate: "2026-02-10", amount: 250, payModel: "ppc", examCount: 20 },
    { bundleDate: "2026-03-01", amount: 999, payModel: "ppc", examCount: 5 },
  ];
  const r = buildExtraDuty(periods, "2026-01-01", "2026-02-28", "month");
  assert.equal(r.total, 350, "March is out of range");
  assert.equal(r.perDiem, 100);
  assert.equal(r.ppc, 250);
  assert.equal(r.exams, 20);
  assert.equal(r.rows.length, 2);
  assert.deepEqual(r.rows.map((x) => x.key), ["2026-01", "2026-02"]);
});

test("perDiem + ppc always equals total — the two models are disjoint", () => {
  const r = buildExtraDuty([
    { bundleDate: "2026-01-05", amount: 100, payModel: "per_diem" },
    { bundleDate: "2026-01-06", amount: 40.4, payModel: "ppc" },
    { bundleDate: "2026-01-07", amount: 59.6, payModel: "ppc" },
  ], null, null, "month");
  assert.equal(r.perDiem + r.ppc, r.total, "a shift counted in both models would double-pay");
});

test("an empty or absent period list is 0, never NaN", () => {
  for (const input of [[], null, undefined]) {
    const r = buildExtraDuty(input, null, null, "month");
    assert.equal(r.total, 0);
    assert.equal(r.rows.length, 0);
    assert.ok(!Number.isNaN(r.total));
  }
});

test("weekly granularity buckets by week start", () => {
  const r = buildExtraDuty([
    { bundleDate: "2026-01-05", amount: 10, payModel: "ppc" },
    { bundleDate: "2026-01-07", amount: 15, payModel: "ppc" },
  ], null, null, "week");
  assert.equal(r.rows.length, 1, "same week collapses to one bucket");
  assert.equal(r.rows[0].amount, 25);
});
