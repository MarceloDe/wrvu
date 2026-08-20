"use client";
// N06 — the dashboard's presentational primitives.
//
// Extracted from components/NeuroRVU.jsx. Every one of these is pure render: no state,
// no fetch, no arithmetic beyond a percentage. Keeping them together means a change to
// a KPI tile cannot reach the money path, and it takes ~90 lines of noise out of the
// file where the money path lives.
import { fmt, comp } from "@/lib/analytics/format.js";
import { instMeta, DEFAULT_INSTITUTIONS } from "@/lib/analytics/institutions.js";
import { Activity, Building2, TrendingUp, TrendingDown } from "lucide-react";

export function TabBtn({ active, onClick, icon: Icon, children }) {
  return <button onClick={onClick} className={`px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors ${active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}><Icon className="w-4 h-4" />{children}</button>;
}

export function InstitutionCards({ split, settings }) {
  const list = settings.institutions ?? DEFAULT_INSTITUTIONS;
  const order = list.map((i) => i.key);
  const meta = Object.fromEntries(list.map((i) => [i.key, i]));
  const total = order.reduce((s, k) => s + (split[k]?.wrvu ?? 0), 0) || 1;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {order.map(k => {
        const inst = meta[k] ?? instMeta(k), d = split[k] ?? { wrvu: 0, studies: 0 }, pct = (d.wrvu / total) * 100;
        return (
          <div key={k} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wide text-slate-400 flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5" style={{ color: inst.color }} />{inst.label}</span>
              <span className="text-[11px] font-mono text-slate-400">{fmt(pct, 0)}%</span>
            </div>
            <div className="mt-2 text-2xl font-bold font-mono tracking-tight">{fmt(d.wrvu, 0)}</div>
            <div className="mt-1 flex items-center justify-between text-[11px] text-slate-400"><span>{fmt(d.studies, 0)} studies</span><span className="font-mono">{comp(d.wrvu, settings.ratePerWrvu) ?? ""}</span></div>
            <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: inst.color }} /></div>
          </div>
        );
      })}
    </div>
  );
}
export function Kpi({ icon: Icon, label, value, sub, delta, good, accent }) {
  const up = delta >= 0;
  return (
    <div className={`rounded-2xl border p-4 ${accent ? "bg-slate-900 border-slate-900 text-white" : "bg-white border-slate-200"}`}>
      <div className="flex items-center justify-between"><span className="text-[11px] uppercase tracking-wide text-slate-400">{label}</span><Icon className={`w-4 h-4 ${accent ? "text-teal-400" : "text-slate-300"}`} /></div>
      <div className="mt-2 text-2xl font-bold font-mono tracking-tight">{value}</div>
      <div className="mt-1 flex items-center gap-1.5 text-[11px]">
        {delta !== undefined && <span className={`font-mono font-semibold flex items-center gap-0.5 ${up ? "text-emerald-500" : "text-amber-500"}`}>{up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}{up ? "+" : ""}{fmt(delta, 0)}%</span>}
        <span className={good ? "text-emerald-500 font-semibold" : "text-slate-400"}>{sub}</span>
      </div>
    </div>
  );
}
export function Empty({ msg }) { return <div className="h-40 flex flex-col items-center justify-center text-slate-400 gap-2"><Activity className="w-6 h-6" /><p className="text-sm">{msg || "No data yet."}</p></div>; }
export function StatTile({ label, value, sub }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-xl font-bold font-mono tracking-tight text-slate-900">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}
export function InstRow({ dot, label, v, bold }) {
  return <div className="flex items-center gap-2 text-sm"><span className="w-2 h-2 rounded-full" style={{ background: dot }} /><span className={`flex-1 ${bold ? "font-semibold" : "text-slate-600"}`}>{label}</span><span className={`font-mono text-xs ${bold ? "font-bold" : ""}`}>{v}</span></div>;
}
export function NumCell({ v, onChange }) {
  return <input type="number" value={v} onChange={e => onChange(e.target.value)} className="w-16 text-right border border-slate-200 rounded px-1 py-0.5 text-xs font-mono focus:border-teal-400 outline-none" />;
}
