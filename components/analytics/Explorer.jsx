"use client";
// N06e — the Tracked explorer and the extra-duty panel that shares its date range.
//
// Last of the N06 extractions. These two panels are one feature: the explorer picks a
// period, and the extra-duty table reports the money earned in that same period. Splitting
// them would mean threading the resolved range through two call sites for no gain, so they
// move together and the range is resolved once, here.
//
// Selection state still lives in the ROOT (persisted per user under "nrv_explorer"), not
// here — Timeline unmounts on every tab switch, so a local useState would silently forget
// the user's period each time they looked at something else.
import React, { useMemo } from "react";
import { Calendar, Zap, Info, Trash2, AlertTriangle } from "lucide-react";
import { fmt, localDay, localMonth, daysAgo } from "@/lib/analytics/format.js";
import { buildRange } from "@/lib/analytics/tracked.js";
import { buildExtraDuty } from "@/lib/analytics/extra-duty.js";
import { StatTile, Empty } from "./primitives.jsx";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from "recharts";

export function TrackedExplorer({
  log, settings, explorer, updateExplorer, extraPeriods, onDeletePeriod, deleteError, palette,
}) {
  const C = palette;
  // Unset bounds follow the data: a fresh account keeps tracking its growing span until
  // the user actually picks a period, and only then is anything saved.
  const dataDays = useMemo(
    () => log.map((s) => String(s.date).slice(0, 10)).filter(Boolean).sort(), [log]);
  const dataMin = dataDays[0] || localDay();
  const dataMax = dataDays[dataDays.length - 1] || localDay();
  const { gran, start: rStart, end: rEnd } = explorer;
  const setGran = (g) => updateExplorer({ ...explorer, gran: g });
  const setRStart = (s) => updateExplorer({ ...explorer, start: s });
  const setREnd = (e) => updateExplorer({ ...explorer, end: e });
  const start = rStart || dataMin, end = rEnd || dataMax;
  const preset = (s, e) => updateExplorer({ ...explorer, start: s, end: e });

  const range = useMemo(
    () => buildRange(log, settings, start, end, gran), [log, settings, start, end, gran]);
  const exRange = useMemo(
    () => buildExtraDuty(extraPeriods, start, end, gran), [extraPeriods, start, end, gran]);
  const delPeriod = onDeletePeriod;
  const delError = deleteError;

  return (
    <>
    {/* ===== Tracked explorer: pick a date range + weekly/monthly ===== */}
    <div className="bg-white rounded-2xl border border-slate-200 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="font-semibold flex items-center gap-2"><Calendar className="w-4 h-4 text-teal-600" />Tracked explorer</h2>
          <p className="text-xs text-slate-500">Pick a start &amp; finish date and see your tracked wRVU by week or month.</p>
        </div>
        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5 text-xs font-medium">
          <button onClick={() => setGran("week")} className={`px-3 py-1.5 rounded-md ${gran === "week" ? "bg-white shadow-sm text-slate-900" : "text-slate-500"}`}>Weekly</button>
          <button onClick={() => setGran("month")} className={`px-3 py-1.5 rounded-md ${gran === "month" ? "bg-white shadow-sm text-slate-900" : "text-slate-500"}`}>Monthly</button>
        </div>
      </div>

      {/* Date inputs + quick presets */}
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <label className="flex flex-col gap-1 text-[11px] font-medium text-slate-500">Start
          <input type="date" value={start} min={dataMin} max={end} onChange={e => setRStart(e.target.value)}
            className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm text-slate-900 font-mono" /></label>
        <label className="flex flex-col gap-1 text-[11px] font-medium text-slate-500">Finish
          <input type="date" value={end} min={start} max={dataMax} onChange={e => setREnd(e.target.value)}
            className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm text-slate-900 font-mono" /></label>
        <div className="flex flex-wrap items-center gap-1 text-[11px] font-medium">
          {[
            { l: "This month", s: `${localMonth()}-01`, e: localDay() },
            { l: "Last 30d", s: daysAgo(30), e: localDay() },
            { l: "Last 90d", s: daysAgo(90), e: localDay() },
            { l: "YTD", s: `${new Date().getFullYear()}-01-01`, e: localDay() },
            { l: "All", s: dataMin, e: dataMax },
          ].map(p => (
            <button key={p.l} onClick={() => preset(p.s, p.e)}
              className="px-2.5 py-1 rounded-md bg-slate-100 text-slate-600 hover:bg-slate-200">{p.l}</button>
          ))}
        </div>
      </div>

      {/* Range stat tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-4">
        <StatTile label="Tracked wRVU" value={fmt(range.stats.total, 0)} sub={`${fmt(range.stats.studies, 0)} studies`} />
        <StatTile label={gran === "week" ? "Avg / week" : "Avg / month"} value={fmt(range.stats.avgPerBucket, 0)}
          sub={`vs ${fmt(range.bench, 0)} target · ${range.stats.vsBenchPct >= 0 ? "+" : ""}${fmt(range.stats.vsBenchPct, 0)}%`} />
        <StatTile label="Avg / active day" value={fmt(range.stats.avgPerDay, 1)} sub={`${fmt(range.stats.activeDays, 0)} days logged`} />
        <StatTile label="UM / JHS split" value={`${fmt(range.stats.umPct, 0)} / ${fmt(100 - range.stats.umPct, 0)}`} sub={`${fmt(range.stats.um, 0)} · ${fmt(range.stats.jhs, 0)} wRVU`} />
      </div>

      {/* Range chart */}
      {range.rows.length ? (
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={range.rows} margin={{ top: 10, right: 12, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f6" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis yAxisId="l" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #e2e8f0" }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <ReferenceLine yAxisId="l" y={range.bench} stroke={C.bench} strokeDasharray="5 4" strokeWidth={1.5} />
              <Bar yAxisId="l" dataKey="wrvu" name={gran === "week" ? "Tracked wRVU / week" : "Tracked wRVU / month"} fill={C.trk} radius={[5, 5, 0, 0]} />
              <Line yAxisId="r" type="monotone" dataKey="cum" name="Cumulative" stroke={C.cum} strokeWidth={2} dot={{ r: 2.5 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : <Empty msg="No tracked exams in this date range." />}
      <p className="text-[11px] text-slate-400 mt-2 flex items-start gap-1.5"><Info className="w-3.5 h-3.5 mt-px shrink-0" />
        Dashed line = {gran === "week" ? "weekly" : "monthly"} target ({fmt(range.bench, 0)} wRVU{gran === "week" ? ", = monthly ÷ 4.3" : ""}). Weeks start Monday. Buckets use each exam&apos;s own date.
        {range.stats.best && <> Best {gran === "week" ? "week" : "month"}: <span className="font-medium text-slate-500">{range.stats.best.label}</span> ({fmt(range.stats.best.wrvu, 0)} wRVU).</>}
      </p>
    </div>

    {/* ===== Extra-duty earnings (per-diem + PPC) for the selected range ===== */}
    <div className="bg-white rounded-2xl border border-slate-200 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="font-semibold flex items-center gap-2"><Zap className="w-4 h-4 text-amber-600" />Extra-duty earnings</h2>
          <p className="text-xs text-slate-500">Per-diem &amp; pay-per-click shifts within the range above ({start} → {end}). Tag uploads as extra duty in the Tracker.</p>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-4">
        <StatTile label="Total extra-duty $" value={`$${fmt(exRange.total, 0)}`} sub={`${exRange.periods.length} shift${exRange.periods.length === 1 ? "" : "s"}`} />
        <StatTile label="Per-diem $" value={`$${fmt(exRange.perDiem, 0)}`} />
        <StatTile label="Pay-per-click $" value={`$${fmt(exRange.ppc, 0)}`} />
        <StatTile label="Exams (extra)" value={fmt(exRange.exams, 0)} sub={gran === "week" ? "weekly buckets" : "monthly buckets"} />
      </div>
      {exRange.periods.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
              <th className="py-2 font-medium">Date</th><th className="py-2 font-medium">Model</th>
              <th className="py-2 font-medium text-right">Exams</th><th className="py-2 font-medium">Breakdown</th>
              <th className="py-2 font-medium text-right">$ earned</th><th></th>
            </tr></thead>
            <tbody className="font-mono">
              {exRange.periods.map(p => (
                <tr key={p.id} className="border-b border-slate-50">
                  <td className="py-1.5 font-sans">{String(p.bundleDate).slice(0, 10)}</td>
                  <td className="py-1.5 font-sans">{p.payModel === "ppc" ? "Pay-per-click" : "Per diem"}{p.label ? <span className="text-slate-400"> · {p.label}</span> : ""}</td>
                  <td className="py-1.5 text-right">{fmt(p.examCount, 0)}</td>
                  <td className="py-1.5 text-[11px] text-slate-500">{p.payModel === "ppc" ? `MRI ${p.countMri} · CT ${p.countCt} · XR ${p.countXr}${p.countOther ? ` · Other ${p.countOther}` : ""}` : "—"}</td>
                  <td className="py-1.5 text-right font-semibold text-amber-700">${fmt(p.amount, 0)}</td>
                  <td className="py-1.5 text-right"><button onClick={() => delPeriod(p.id)} className="text-slate-300 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty msg="No extra-duty shifts in this date range." />}
      {delError && (
        <p role="alert" className="mt-3 flex items-start gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
          <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />{delError}
        </p>
      )}
      <p className="text-[11px] text-slate-400 mt-3 flex items-start gap-1.5"><Info className="w-3.5 h-3.5 mt-px shrink-0" />Extra duty is paid separately and never counts toward your wRVU target. Its YTD total is folded into the &quot;Extra pay YTD (all sources)&quot; KPI below.</p>
    </div>
    </>
  );
}
