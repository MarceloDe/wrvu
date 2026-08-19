// Consolidating the REPORTED baseline — the monthly figures from the HR/RVU report.
//
// Extracted verbatim from components/NeuroRVU.jsx (N06b). Nothing about the behaviour
// changed; the point of moving it is that this is the arithmetic N18 is about to disturb
// when institutions stop being two hardcoded names, and it should be under test before
// that happens rather than after.
//
// THE EPSILONS ARE THE INTERESTING PART. A re-exported report re-states the same month
// with tiny differences — rounding in the source system, a cent of extra pay, a cFTE
// that moves in the fourth decimal. Comparing exactly would flag every month as a
// discrepancy and train the user to click through the review panel without reading it,
// which is worse than not having the panel. So each field has a tolerance:
//
//   pay    1      dollars — a dollar of drift is not news
//   cfte   0.01   an FTE fraction only matters to two places
//   others 0.5    half a wRVU, below the resolution anyone reports
//
// Consolidation rules, per the spec:
//   - key (YYYY-MM) is the insertion dimension
//   - months not yet stored are ADDED
//   - months already stored are kept; if an incoming value differs beyond its epsilon we
//     record a DISCREPANCY (old vs new) and take the newer report's value
//   - existing months absent from the new report are left untouched
import { num, MONTH_LABEL } from "./format.js";

export const BASELINE_FIELDS = ["bench", "base", "extra", "pay", "cfte"];

export const FIELD_LABEL = {
  bench: "Benchmark", base: "Actual (base)", extra: "Extra coverage",
  pay: "Extra pay ($)", cfte: "cFTE",
};

/** Tolerance below which a re-stated figure is the same figure. */
export const epsilonFor = (field) => (field === "pay" ? 1 : field === "cfte" ? 0.01 : 0.5);

/** @returns {{merged:Array, added:Array, updated:Array, unchanged:Array, discrepancies:Array, skipped:Array}} */
export function consolidateBaseline(existing, incoming) {
  const byKey = new Map((existing || []).map((b) => [b.key, { ...b }]));
  const added = [], updated = [], unchanged = [], discrepancies = [], skipped = [];
  for (const raw of incoming || []) {
    const key = String(raw.month || raw.key || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(key)) { skipped.push(raw); continue; }
    const row = {
      key,
      mo: MONTH_LABEL(key),
      cfte: num(raw.cfte),
      bench: num(raw.bench),
      base: num(raw.base),
      extra: num(raw.extra),
      pay: num(raw.pay),
    };
    // Ignore fully-empty months (nothing to store).
    if (!row.bench && !row.base && !row.extra && !row.pay) { skipped.push(raw); continue; }
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, row); added.push(row); continue; }
    const changes = [];
    for (const f of BASELINE_FIELDS) {
      if (Math.abs((Number(prev[f]) || 0) - row[f]) > epsilonFor(f)) {
        changes.push({ field: f, from: Number(prev[f]) || 0, to: row[f] });
      }
    }
    if (changes.length) {
      byKey.set(key, { ...prev, ...row });
      updated.push(row);
      discrepancies.push({ key, mo: row.mo, changes });
    } else unchanged.push(row);
  }
  const merged = [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
  return { merged, added, updated, unchanged, discrepancies, skipped };
}
