// Characterisation tests for consolidateBaseline, written from its BEHAVIOUR before the
// N06b extraction so the move is provably behaviour-preserving — and so N18 cannot
// quietly change the reported-baseline math while generalising institutions.
//
// The epsilons get the most attention because they are the part with a human cost:
// too tight and every re-exported report is a wall of false discrepancies, which trains
// the user to click through the review panel without reading it.
import test from "node:test";
import assert from "node:assert/strict";
import { consolidateBaseline, epsilonFor, BASELINE_FIELDS } from "../lib/analytics/baseline.js";

const month = (over = {}) => ({ month: "2026-07", bench: 500, base: 480, extra: 20, pay: 2700, cfte: 1, ...over });

test("a month not yet stored is added", () => {
  const r = consolidateBaseline([], [month()]);
  assert.equal(r.added.length, 1);
  assert.equal(r.merged.length, 1);
  assert.equal(r.merged[0].key, "2026-07");
  assert.equal(r.discrepancies.length, 0);
});

test("a re-stated month within tolerance is unchanged, not a discrepancy", () => {
  const first = consolidateBaseline([], [month()]).merged;
  // Every field nudged by strictly less than its epsilon.
  const r = consolidateBaseline(first, [month({ bench: 500.4, base: 479.6, extra: 20.4, pay: 2700.9, cfte: 1.009 })]);
  assert.equal(r.unchanged.length, 1, "should be treated as the same figures");
  assert.equal(r.discrepancies.length, 0);
  assert.equal(r.updated.length, 0);
});

test("a change beyond tolerance is a discrepancy and the newer value wins", () => {
  const first = consolidateBaseline([], [month()]).merged;
  const r = consolidateBaseline(first, [month({ bench: 520 })]);
  assert.equal(r.discrepancies.length, 1);
  const change = r.discrepancies[0].changes.find((c) => c.field === "bench");
  assert.deepEqual({ from: change.from, to: change.to }, { from: 500, to: 520 });
  assert.equal(r.merged[0].bench, 520, "the newer report's value is taken");
});

test("each field keeps its own tolerance", () => {
  assert.equal(epsilonFor("pay"), 1);
  assert.equal(epsilonFor("cfte"), 0.01);
  for (const f of BASELINE_FIELDS.filter((f) => f !== "pay" && f !== "cfte")) {
    assert.equal(epsilonFor(f), 0.5, `${f} should use the default tolerance`);
  }
});

test("the tolerance is exclusive: exactly epsilon is still the same figure", () => {
  const first = consolidateBaseline([], [month()]).merged;
  const r = consolidateBaseline(first, [month({ pay: 2701 })]);   // exactly 1 away
  assert.equal(r.discrepancies.length, 0, "a difference equal to epsilon must not flag");
});

test("a month absent from the new report is left untouched", () => {
  const existing = consolidateBaseline([], [month({ month: "2026-06" }), month()]).merged;
  const r = consolidateBaseline(existing, [month({ month: "2026-07", bench: 999 })]);
  const june = r.merged.find((m) => m.key === "2026-06");
  assert.equal(june.bench, 500, "June must survive a report that only covers July");
  assert.equal(r.merged.length, 2);
});

test("a malformed key is skipped, never stored", () => {
  const r = consolidateBaseline([], [{ month: "not-a-month", bench: 100 }, { bench: 100 }]);
  assert.equal(r.skipped.length, 2);
  assert.equal(r.merged.length, 0);
});

test("a month with no figures at all is skipped", () => {
  const r = consolidateBaseline([], [{ month: "2026-07", bench: 0, base: 0, extra: 0, pay: 0, cfte: 1 }]);
  assert.equal(r.skipped.length, 1, "cFTE alone is not a month worth storing");
  assert.equal(r.merged.length, 0);
});

test("non-numeric input becomes 0, never NaN", () => {
  const r = consolidateBaseline([], [{ month: "2026-07", bench: "abc", base: 480, extra: null, pay: undefined, cfte: "x" }]);
  const row = r.merged[0];
  for (const f of BASELINE_FIELDS) {
    assert.ok(Number.isFinite(row[f]), `${f} must be finite, got ${row[f]}`);
  }
  assert.equal(row.bench, 0);
});

test("merged output is sorted by month", () => {
  const r = consolidateBaseline([], [month({ month: "2026-09" }), month({ month: "2026-07" }), month({ month: "2026-08" })]);
  assert.deepEqual(r.merged.map((m) => m.key), ["2026-07", "2026-08", "2026-09"]);
});
