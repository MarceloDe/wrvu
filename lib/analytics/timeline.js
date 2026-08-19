// The REPORTED layer: the HR/RVU report's monthly figures, and how they are attributed.
//
// Extracted from components/NeuroRVU.jsx (N06). This is the two-layer reported-vs-tracked
// model the backlog says to preserve exactly, and the arithmetic N18 generalises.
//
// The attribution is a PROPORTIONAL SPLIT: the report gives one total per month, and it
// is divided between institutions by their YTD share. Note that jhsShare is 1 - umShare
// rather than jhsYTD/denom — deliberate, so the two shares sum to exactly 1 and no wRVU
// is lost or invented to floating-point drift. Generalising to N institutions means
// giving the remainder to the last one for the same reason.
//
// `|| 1` on the denominator is the guard for a user who has entered no YTD figures at
// all: without it the shares are NaN and every reported number downstream becomes NaN.
import { monthKey, MONTH_LABEL } from "./format.js";
import { classifyInstitution, makeClassifier, DEFAULT_INSTITUTIONS, defaultKeyOf } from "./institutions.js";

/**
 * Split one reported total across N institutions by their YTD share.
 *
 * The remainder goes to the LAST non-default institution rather than being computed
 * independently. That is not tidiness: independently computed shares do not sum to 1 in
 * floating point — 1/3 + 2/3 is not 1 — and the difference is wRVU that silently vanishes
 * from the reported split. The old two-institution code did exactly this with
 * `jhsShare = 1 - umShare`, and generalising means keeping the habit, not dropping it.
 *
 * `|| 1` guards a user who has entered no YTD figures at all. Without it every share is
 * NaN, and NaN propagates through every reported number downstream without ever throwing.
 */
export function sharesFor(institutions, ytdByKey) {
  const fallback = defaultKeyOf(institutions);
  const attributable = institutions.filter((i) => i.key !== fallback);
  const denom = attributable.reduce((sum, i) => sum + (Number(ytdByKey[i.key]) || 0), 0) || 1;
  const shares = {};
  let assigned = 0;
  attributable.forEach((i, idx) => {
    if (idx === attributable.length - 1) shares[i.key] = 1 - assigned;   // the remainder
    else { const s = (Number(ytdByKey[i.key]) || 0) / denom; shares[i.key] = s; assigned += s; }
  });
  shares[fallback] = 0;   // unattributed work is not part of the reported split
  return shares;
}

export function buildTimeline(baseline, log, settings) {
  // Resolved first: the tracked loop below classifies sites, so the classifier has to
  // exist before it runs. (It did not, briefly, and the TDZ error was immediate — the
  // kind of mistake that is loud rather than subtle.)
  const institutions = settings.institutions ?? DEFAULT_INSTITUTIONS;
  const classify = settings.institutions || settings.siteOverrides
    ? makeClassifier(institutions, settings.siteOverrides ?? {})
    : classifyInstitution;
  const tracked = {};
  for (const s of log) {
    const k = monthKey(s.date);
    tracked[k] = tracked[k] || { wrvu: 0, studies: 0, um: 0, jhs: 0 };
    for (const i of s.items) {
      const w = i.count * i.wrvu, site = classify(i.inst);
      tracked[k].wrvu += w; tracked[k].studies += i.count;
      if (site === "UM") tracked[k].um += w; if (site === "JHS") tracked[k].jhs += w;
    }
  }
  const ytdByKey = settings.ytdByInstitution
    ?? { UM: settings.umYTD, JHS: settings.jhsYTD };   // today's two scalars
  const shares = sharesFor(institutions, ytdByKey);
  const umShare = shares.UM ?? 0, jhsShare = shares.JHS ?? 0;
  const keys = [...new Set([...baseline.map(b => b.key), ...Object.keys(tracked)])].sort();
  let cumRep = 0, cumTrk = 0, cumBench = 0;
  const months = keys.map(k => {
    const b = baseline.find(x => x.key === k), t = tracked[k];
    const bench = b ? b.bench : Math.round(settings.monthlyBenchmark * settings.cFTE);
    const reported = b ? b.base : 0, extra = b ? b.extra : 0, total = reported + extra;
    const trk = t ? t.wrvu : 0;
    cumRep += reported; cumBench += bench; cumTrk += trk;
    return {
      key: k, mo: b ? b.mo : MONTH_LABEL(k), bench, reported, extra, total,
      // Legacy keys kept so nothing in the UI has to change in the same commit as the
      // schema. `reported` is the general form the UI moves to next.
      repUM: Math.round(total * umShare), repJHS: Math.round(total * jhsShare),
      reported_by_institution: Object.fromEntries(
        institutions.map((i) => [i.key, Math.round(total * (shares[i.key] ?? 0))])),
      tracked: Math.round(trk), trackedStudies: t ? t.studies : 0, trkUM: t ? t.um : 0, trkJHS: t ? t.jhs : 0,
      cumReported: cumRep, cumBench, cumTracked: Math.round(cumTrk),
      capture: reported ? (trk / reported) * 100 : (trk ? 100 : 0),
      variance: reported - bench, variancePct: bench ? ((reported / bench) - 1) * 100 : 0,
    };
  });
  const base = baseline.reduce((s, b) => s + b.base, 0), bench = baseline.reduce((s, b) => s + b.bench, 0);
  const extra = baseline.reduce((s, b) => s + b.extra, 0), pay = baseline.reduce((s, b) => s + b.pay, 0);
  const ytd = { base, bench, extra, pay, total: base + extra, variancePct: bench ? ((base / bench) - 1) * 100 : 0 };
  return { months, ytd, umShare, jhsShare, shares, institutions };
}
