// D35 / G4.2 — "dollar figures are HIDDEN rather than shown as zero when no rate is set".
//
// The failure this prevents is subtle and was live until N33: a brand-new user saw
// "Tracked comp value $0 @ $78/wRVU" — a dollar amount computed from a rate they had never
// entered, presented as their compensation. $0 is not a neutral placeholder; it is a claim.
import test from "node:test";
import assert from "node:assert/strict";
import { hasRate, comp } from "../lib/analytics/format.js";

test("an unset rate is not a rate", () => {
  for (const missing of [null, undefined, "", 0, -5, NaN, "abc"]) {
    assert.equal(hasRate(missing), false, `${String(missing)} must not count as a rate`);
    assert.equal(comp(1000, missing), null, `${String(missing)} must produce no dollar figure`);
  }
});

test("a real rate produces a real figure", () => {
  assert.equal(comp(100, 78), "$7,800");
  assert.equal(comp(0, 78), "$0", "zero wRVU at a known rate IS legitimately $0");
  assert.equal(hasRate(78), true);
  assert.equal(hasRate("78"), true, "a string from an input still counts");
});

test("zero wRVU and zero rate are different claims", () => {
  // The whole point: "you earned $0" and "we do not know what you earn" must not render
  // the same way.
  assert.equal(comp(0, 78), "$0");
  assert.equal(comp(500, null), null);
});

test("digits are honoured for the callers that need cents", () => {
  assert.equal(comp(1, 78, 2), "$78.00");
});
