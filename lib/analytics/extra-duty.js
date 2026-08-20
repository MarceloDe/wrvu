// Extra-duty pay: work paid separately from the wRVU target.
//
// Extracted from components/NeuroRVU.jsx (N06d). These are pure functions over the
// aggregate period rows, which is why they belong in lib/ rather than in a component:
// the arithmetic that turns shifts into dollars is testable, and it was not under test
// while it lived inside an 1,800-line file.
//
// The rate snapshot is the important property and it is preserved upstream, not here:
// `amount` and `rateSnapshot` are frozen on the period row at save time, so editing a
// rate later never re-prices a past shift. Nothing in this module recomputes a rate —
// it only sums what was already frozen.
import { weekStartKey, WEEK_LABEL, MONTH_LABEL } from "./format.js";

/**
 * Map a worklist modality onto a PPC pay bucket.
 *
 * This function was always right: an unrecognised modality falls to "other", which is
 * NOT paid. The bug was upstream — every call site defaulted an unknown modality to
 * "CT" before it got here, so nothing was ever unrecognised and every unknown study was
 * paid at the CT rate. The reference schema knows the modality for all 828 codes,
 * including 236 XR, so nothing has to be guessed any more. Unknown now means unknown.
 */
export const PPC_BUCKET = (mod) => {
  const m = String(mod || "").toUpperCase();
  if (m.includes("MR")) return "mri";                        // MRI, MRA
  if (m.includes("CT")) return "ct";                         // CT, CTA
  if (/XR|CR|DX|X-?RAY|RADIOGRAPH/.test(m)) return "xr";
  return "other";                                            // US, NM, Add-on… (not paid)
};

export function bucketCounts(items) {
  const c = { mri: 0, ct: 0, xr: 0, other: 0 };
  for (const i of items || []) c[PPC_BUCKET(i.mod)] += (i.count || 1);
  return c;
}

/**
 * Bucket extra-duty periods by week/month within [start, end] and total the
 * snapshotted dollars. Pure summation — no rate lookup, no double-count.
 */
export function buildExtraDuty(periods, start, end, gran) {
  const buckets = {};
  let total = 0, perDiem = 0, ppc = 0, exams = 0;
  const inRange = [];
  for (const p of periods || []) {
    const day = String(p.bundleDate).slice(0, 10);
    if (!day || (start && day < start) || (end && day > end)) continue;
    inRange.push(p);
    const amt = Number(p.amount) || 0;
    total += amt; exams += Number(p.examCount) || 0;
    if (p.payModel === "ppc") ppc += amt; else perDiem += amt;
    const k = gran === "week" ? weekStartKey(day) : day.slice(0, 7);
    buckets[k] = (buckets[k] || 0) + amt;
  }
  const rows = Object.keys(buckets).sort().map((k) => ({
    key: k, label: gran === "week" ? WEEK_LABEL(k) : MONTH_LABEL(k), amount: Math.round(buckets[k]),
  }));
  return {
    rows, total: Math.round(total), perDiem: Math.round(perDiem), ppc: Math.round(ppc), exams,
    periods: inRange.sort((a, b) => String(b.bundleDate).localeCompare(String(a.bundleDate))),
  };
}
