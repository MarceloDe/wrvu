// The TRACKED layer: what the radiologist actually logged, aggregated.
//
// Extracted from components/NeuroRVU.jsx (N06). Distinct from the reported layer in
// timeline.js — tracked figures come from exams the user captured, reported figures come
// from the employer's report, and the whole point of the two-layer model is that they are
// allowed to disagree and the difference is visible (`capture`).
import { monthKey, MONTH_LABEL, localMonth, weekStartKey, WEEK_LABEL } from "./format.js";
import { classifyInstitution, makeClassifier, DEFAULT_INSTITUTIONS, defaultKeyOf } from "./institutions.js";

// The institution set and classifier for a given call. Both builders used to close over
// the module-level three-key version; taking them from `settings` is what lets the UI
// hand in the user's actual rows without either builder knowing where they came from.
function resolve(settings) {
  const institutions = settings.institutions ?? DEFAULT_INSTITUTIONS;
  const classify = settings.institutions || settings.siteOverrides
    ? makeClassifier(institutions, settings.siteOverrides ?? {})
    : classifyInstitution;
  return { institutions, classify, fallback: defaultKeyOf(institutions) };
}
import { TAXONOMY } from "../data/neuro-taxonomy.js";

// Display metadata only — the modality fallback for a code the taxonomy knows.
const codeByCpt = Object.fromEntries(TAXONOMY.map((c) => [c.cpt.replace("+", ""), c]));

export function buildAnalytics(log, settings) {
  const { institutions, classify } = resolve(settings);
  const byMonth = {}, byType = {};
  // Every institution gets a bucket up front, so one with no exams reports 0 rather than
  // disappearing from the UI — an absent institution reads as "not configured", which is
  // a different thing from "no work this month".
  const institution = Object.fromEntries(institutions.map((i) => [i.key, { wrvu: 0, studies: 0 }]));
  for (const s of log) {
    const k = monthKey(s.date); byMonth[k] = byMonth[k] || { wrvu: 0, studies: 0, um: 0, jhs: 0 };
    for (const i of s.items) {
      const w = i.count * i.wrvu; byMonth[k].wrvu += w; byMonth[k].studies += i.count;
      const site = classify(i.inst);
      institution[site] = institution[site] || { wrvu: 0, studies: 0 };
      institution[site].wrvu += w; institution[site].studies += i.count;
      if (site === "UM") byMonth[k].um += w; if (site === "JHS") byMonth[k].jhs += w;
      if (!byType[i.cpt]) { const canon = codeByCpt[i.cpt.replace("+", "")] || {}; byType[i.cpt] = { cpt: i.cpt, desc: i.desc, mod: i.mod || canon.mod || "Other", perStudy: i.wrvu, count: 0, wrvu: 0, byInst: {} }; }
      byType[i.cpt].count += i.count; byType[i.cpt].wrvu += w;
      byType[i.cpt].byInst[site] = byType[i.cpt].byInst[site] || { count: 0, wrvu: 0 };
      byType[i.cpt].byInst[site].count += i.count; byType[i.cpt].byInst[site].wrvu += w;
    }
  }
  const keys = Object.keys(byMonth).sort();
  const months = keys.map(k => { const d = byMonth[k], bench = settings.monthlyBenchmark * settings.cFTE, variance = d.wrvu - bench; return { key: k, label: MONTH_LABEL(k), actual: d.wrvu, bench, studies: d.studies, um: d.um, jhs: d.jhs, variance, variancePct: bench ? (variance / bench) * 100 : 0 }; });
  const nowKey = localMonth(), tm = byMonth[nowKey] || { wrvu: 0 }, tmBench = settings.monthlyBenchmark * settings.cFTE;
  const thisMonth = { actual: tm.wrvu, bench: tmBench, variancePct: tmBench ? ((tm.wrvu - tmBench) / tmBench) * 100 : 0 };
  const ytdActual = months.reduce((s, m) => s + m.actual, 0), ytdStudies = months.reduce((s, m) => s + m.studies, 0), ytdBench = months.reduce((s, m) => s + m.bench, 0);
  const ytd = { actual: ytdActual, studies: ytdStudies, bench: ytdBench, variance: ytdActual - ytdBench, variancePct: ytdBench ? ((ytdActual - ytdBench) / ytdBench) * 100 : 0 };
  const monthsElapsed = Math.max(months.length, 1), projected = (ytdActual / monthsElapsed) * 12, annualBench = settings.monthlyBenchmark * 12 * settings.cFTE;
  const annual = { projected, bench: annualBench, variancePct: annualBench ? ((projected - annualBench) / annualBench) * 100 : 0 };
  return { months, thisMonth, ytd, annual, institution, byType };
}

export function buildRange(log, settings, start, end, gran) {
  const { classify } = resolve(settings);
  const buckets = {};
  const activeDays = new Set();
  let total = 0, studies = 0, um = 0, jhs = 0;
  for (const s of log) {
    const day = String(s.date).slice(0, 10);
    if (!day || (start && day < start) || (end && day > end)) continue;
    const k = gran === "week" ? weekStartKey(day) : day.slice(0, 7);
    const b = buckets[k] || (buckets[k] = { key: k, wrvu: 0, studies: 0, um: 0, jhs: 0 });
    for (const i of s.items) {
      const cnt = i.count || 1, w = cnt * (Number(i.wrvu) || 0), site = classify(i.inst);
      b.wrvu += w; b.studies += cnt; total += w; studies += cnt;
      if (site === "UM") { b.um += w; um += w; }
      if (site === "JHS") { b.jhs += w; jhs += w; }
    }
    activeDays.add(day);
  }
  let cum = 0;
  const rows = Object.keys(buckets).sort().map((k) => {
    const b = buckets[k]; cum += b.wrvu;
    return { key: k, label: gran === "week" ? WEEK_LABEL(k) : MONTH_LABEL(k),
      wrvu: Math.round(b.wrvu * 10) / 10, studies: b.studies,
      um: Math.round(b.um), jhs: Math.round(b.jhs), cum: Math.round(cum * 10) / 10 };
  });
  const monthlyBench = settings.monthlyBenchmark * settings.cFTE;
  const bench = gran === "week" ? (monthlyBench * 12) / 52 : monthlyBench;
  const nB = rows.length || 1, nDays = activeDays.size || 1;
  const best = rows.reduce((a, r) => (a && a.wrvu >= r.wrvu ? a : r), null);
  const stats = {
    total: Math.round(total * 10) / 10, studies, buckets: rows.length, activeDays: activeDays.size,
    avgPerBucket: Math.round((total / nB) * 10) / 10, avgPerDay: Math.round((total / nDays) * 10) / 10,
    vsBenchPct: bench ? ((total / nB / bench) - 1) * 100 : 0,
    um: Math.round(um), jhs: Math.round(jhs), umPct: (um + jhs) ? (um / (um + jhs)) * 100 : 0,
    best,
  };
  return { rows, stats, bench: Math.round(bench) };
}
