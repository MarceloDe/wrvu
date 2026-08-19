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
import { classifyInstitution } from "./institutions.js";

export function buildTimeline(baseline, log, settings) {
  const tracked = {};
  for (const s of log) {
    const k = monthKey(s.date);
    tracked[k] = tracked[k] || { wrvu: 0, studies: 0, um: 0, jhs: 0 };
    for (const i of s.items) {
      const w = i.count * i.wrvu, site = classifyInstitution(i.inst);
      tracked[k].wrvu += w; tracked[k].studies += i.count;
      if (site === "UM") tracked[k].um += w; if (site === "JHS") tracked[k].jhs += w;
    }
  }
  const denom = (settings.umYTD + settings.jhsYTD) || 1;
  const umShare = settings.umYTD / denom, jhsShare = 1 - umShare;
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
      repUM: Math.round(total * umShare), repJHS: Math.round(total * jhsShare),
      tracked: Math.round(trk), trackedStudies: t ? t.studies : 0, trkUM: t ? t.um : 0, trkJHS: t ? t.jhs : 0,
      cumReported: cumRep, cumBench, cumTracked: Math.round(cumTrk),
      capture: reported ? (trk / reported) * 100 : (trk ? 100 : 0),
      variance: reported - bench, variancePct: bench ? ((reported / bench) - 1) * 100 : 0,
    };
  });
  const base = baseline.reduce((s, b) => s + b.base, 0), bench = baseline.reduce((s, b) => s + b.bench, 0);
  const extra = baseline.reduce((s, b) => s + b.extra, 0), pay = baseline.reduce((s, b) => s + b.pay, 0);
  const ytd = { base, bench, extra, pay, total: base + extra, variancePct: bench ? ((base / bench) - 1) * 100 : 0 };
  return { months, ytd, umShare, jhsShare };
}
