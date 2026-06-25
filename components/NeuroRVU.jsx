"use client";
import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Brain, Activity, Upload, Camera, Search, Settings as SettingsIcon, Plus, Trash2,
  TrendingUp, TrendingDown, Loader2, Sparkles, X, FileImage, Calendar,
  Target, DollarSign, Database, Zap, Check, Building2, Layers, AlertTriangle,
  LineChart as LineIcon, CheckCircle2, Info, RotateCcw
} from "lucide-react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, Cell, PieChart, Pie
} from "recharts";
import { extractionSystemPrompt, extractionUserText } from "../lib/ocr-prompt";

/* ============================================================================
   NEURORADIOLOGY CPT REFERENCE — CMS 2026 professional-component work RVU
   ========================================================================== */
const CF_2026 = 33.40;
const CODES = [
  { cpt:"70450", mod:"CT",  region:"Head/Brain", desc:"CT Head/Brain", con:"W/O",  wrvu:0.83 },
  { cpt:"70460", mod:"CT",  region:"Head/Brain", desc:"CT Head/Brain", con:"W",    wrvu:1.10 },
  { cpt:"70470", mod:"CT",  region:"Head/Brain", desc:"CT Head/Brain", con:"W/WO", wrvu:1.24 },
  { cpt:"70480", mod:"CT",  region:"Orbit/Sella/IAC/Temporal", desc:"CT Orbit/Sella/Post Fossa/Temporal Bone/IAC", con:"W/O",  wrvu:1.19 },
  { cpt:"70481", mod:"CT",  region:"Orbit/Sella/IAC/Temporal", desc:"CT Orbit/Sella/Post Fossa/Temporal Bone/IAC", con:"W",    wrvu:1.32 },
  { cpt:"70482", mod:"CT",  region:"Orbit/Sella/IAC/Temporal", desc:"CT Orbit/Sella/Post Fossa/Temporal Bone/IAC", con:"W/WO", wrvu:1.38 },
  { cpt:"70486", mod:"CT",  region:"Maxillofacial/Sinus", desc:"CT Maxillofacial / Sinus", con:"W/O",  wrvu:0.96, est:true },
  { cpt:"70487", mod:"CT",  region:"Maxillofacial/Sinus", desc:"CT Maxillofacial / Sinus", con:"W",    wrvu:1.07, est:true },
  { cpt:"70488", mod:"CT",  region:"Maxillofacial/Sinus", desc:"CT Maxillofacial / Sinus", con:"W/WO", wrvu:1.16, est:true },
  { cpt:"70490", mod:"CT",  region:"Soft Tissue Neck", desc:"CT Soft Tissue Neck", con:"W/O",  wrvu:0.96 },
  { cpt:"70491", mod:"CT",  region:"Soft Tissue Neck", desc:"CT Soft Tissue Neck", con:"W",    wrvu:1.06 },
  { cpt:"70492", mod:"CT",  region:"Soft Tissue Neck", desc:"CT Neck W/WO (incl. 4D parathyroid)", con:"W/WO", wrvu:1.16 },
  { cpt:"72125", mod:"CT",  region:"C-Spine", desc:"CT Cervical Spine", con:"W/O",  wrvu:1.16 },
  { cpt:"72126", mod:"CT",  region:"C-Spine", desc:"CT Cervical Spine", con:"W",    wrvu:1.27 },
  { cpt:"72127", mod:"CT",  region:"C-Spine", desc:"CT Cervical Spine", con:"W/WO", wrvu:1.42 },
  { cpt:"72128", mod:"CT",  region:"T-Spine", desc:"CT Thoracic Spine", con:"W/O",  wrvu:1.16 },
  { cpt:"72129", mod:"CT",  region:"T-Spine", desc:"CT Thoracic Spine", con:"W",    wrvu:1.27 },
  { cpt:"72130", mod:"CT",  region:"T-Spine", desc:"CT Thoracic Spine", con:"W/WO", wrvu:1.42 },
  { cpt:"72131", mod:"CT",  region:"L-Spine", desc:"CT Lumbar Spine", con:"W/O",  wrvu:1.16 },
  { cpt:"72132", mod:"CT",  region:"L-Spine", desc:"CT Lumbar Spine", con:"W",    wrvu:1.27 },
  { cpt:"72133", mod:"CT",  region:"L-Spine", desc:"CT Lumbar Spine", con:"W/WO", wrvu:1.42 },
  { cpt:"72240", mod:"CT",  region:"Myelography", desc:"Myelography Cervical (S&I)", con:"—", wrvu:1.16, est:true },
  { cpt:"72255", mod:"CT",  region:"Myelography", desc:"Myelography Thoracic (S&I)", con:"—", wrvu:1.16, est:true },
  { cpt:"72265", mod:"CT",  region:"Myelography", desc:"Myelography Lumbar (S&I)",   con:"—", wrvu:1.00, est:true },
  { cpt:"72270", mod:"CT",  region:"Myelography", desc:"Myelography 2+ Regions (S&I)", con:"—", wrvu:1.39, est:true },
  { cpt:"70496", mod:"CTA", region:"Head",        desc:"CTA Head (incl. CTV)",  con:"W", wrvu:1.75 },
  { cpt:"70498", mod:"CTA", region:"Neck",        desc:"CTA Neck (incl. CTV)",  con:"W", wrvu:1.75 },
  { cpt:"70471", mod:"CTA", region:"Head & Neck", desc:"CTA Head & Neck (combined)", con:"W", wrvu:2.50, flag:"2026" },
  { cpt:"70473", mod:"CTA", region:"Perfusion",   desc:"CT Cerebral Perfusion (standalone)", con:"W", wrvu:1.20, est:true, flag:"2026" },
  { cpt:"70472", mod:"CTA", region:"Perfusion",   desc:"CT Cerebral Perfusion (add-on w/ CTA)", con:"W", wrvu:0.80, est:true, flag:"add-on" },
  { cpt:"70551", mod:"MRI", region:"Brain", desc:"MRI Brain / Brainstem (incl. IAC, pituitary)", con:"W/O",  wrvu:1.45 },
  { cpt:"70552", mod:"MRI", region:"Brain", desc:"MRI Brain / Brainstem (incl. IAC, pituitary)", con:"W",    wrvu:1.78 },
  { cpt:"70553", mod:"MRI", region:"Brain", desc:"MRI Brain / Brainstem (incl. IAC, pituitary)", con:"W/WO", wrvu:2.23 },
  { cpt:"70554", mod:"MRI", region:"Brain", desc:"fMRI Brain (tech administered)",      con:"—", wrvu:1.43, est:true },
  { cpt:"70555", mod:"MRI", region:"Brain", desc:"fMRI Brain (physician administered)", con:"—", wrvu:1.43, est:true },
  { cpt:"76390", mod:"MRI", region:"Brain", desc:"MR Spectroscopy",                     con:"—", wrvu:1.46, est:true },
  { cpt:"70557", mod:"MRI", region:"Brain (Intraop)", desc:"MRI Brain during open intracranial procedure", con:"W/O",  wrvu:1.50, est:true },
  { cpt:"70558", mod:"MRI", region:"Brain (Intraop)", desc:"MRI Brain during open intracranial procedure", con:"W",    wrvu:1.80, est:true },
  { cpt:"70559", mod:"MRI", region:"Brain (Intraop)", desc:"MRI Brain during open intracranial procedure", con:"W/WO", wrvu:2.20, est:true },
  { cpt:"70540", mod:"MRI", region:"Orbit/Face/Neck", desc:"MRI Orbit / Face / Neck", con:"W/O",  wrvu:1.48 },
  { cpt:"70542", mod:"MRI", region:"Orbit/Face/Neck", desc:"MRI Orbit / Face / Neck", con:"W",    wrvu:1.84 },
  { cpt:"70543", mod:"MRI", region:"Orbit/Face/Neck", desc:"MRI Orbit / Face / Neck", con:"W/WO", wrvu:2.16 },
  { cpt:"70336", mod:"MRI", region:"TMJ", desc:"MRI Temporomandibular Joint", con:"—", wrvu:1.48, est:true },
  { cpt:"72141", mod:"MRI", region:"C-Spine", desc:"MRI Cervical Spine", con:"W/O",  wrvu:1.22 },
  { cpt:"72142", mod:"MRI", region:"C-Spine", desc:"MRI Cervical Spine", con:"W",    wrvu:1.40, est:true },
  { cpt:"72156", mod:"MRI", region:"C-Spine", desc:"MRI Cervical Spine", con:"W/WO", wrvu:1.84, est:true },
  { cpt:"72146", mod:"MRI", region:"T-Spine", desc:"MRI Thoracic Spine", con:"W/O",  wrvu:1.22, est:true },
  { cpt:"72147", mod:"MRI", region:"T-Spine", desc:"MRI Thoracic Spine", con:"W",    wrvu:1.40, est:true },
  { cpt:"72157", mod:"MRI", region:"T-Spine", desc:"MRI Thoracic Spine", con:"W/WO", wrvu:1.84, est:true },
  { cpt:"72148", mod:"MRI", region:"L-Spine", desc:"MRI Lumbar Spine", con:"W/O",  wrvu:1.19 },
  { cpt:"72149", mod:"MRI", region:"L-Spine", desc:"MRI Lumbar Spine", con:"W",    wrvu:1.40, est:true },
  { cpt:"72158", mod:"MRI", region:"L-Spine", desc:"MRI Lumbar Spine", con:"W/WO", wrvu:1.87 },
  { cpt:"70544", mod:"MRA", region:"Head", desc:"MRA Head (incl. MRV)", con:"W/O",  wrvu:1.20 },
  { cpt:"70545", mod:"MRA", region:"Head", desc:"MRA Head (incl. MRV)", con:"W",    wrvu:1.42 },
  { cpt:"70546", mod:"MRA", region:"Head", desc:"MRA Head (incl. MRV)", con:"W/WO", wrvu:1.60 },
  { cpt:"70547", mod:"MRA", region:"Neck", desc:"MRA Neck (carotids)", con:"W/O",  wrvu:1.20 },
  { cpt:"70548", mod:"MRA", region:"Neck", desc:"MRA Neck (carotids)", con:"W",    wrvu:1.49 },
  { cpt:"70549", mod:"MRA", region:"Neck", desc:"MRA Neck (carotids)", con:"W/WO", wrvu:1.71 },
  { cpt:"72159", mod:"MRA", region:"Spine", desc:"MRA Spinal Canal", con:"W/WO", wrvu:1.43, est:true },
  { cpt:"76376", mod:"Add-on", region:"3D Post-Processing", desc:"3D Rendering (no independent workstation)", con:"—", wrvu:0.20, est:true, flag:"add-on" },
  { cpt:"76377", mod:"Add-on", region:"3D Post-Processing", desc:"3D Rendering (independent workstation)", con:"—", wrvu:0.79, est:true, flag:"add-on" },
];
const MOD_COLORS = { CT:"#0d9488", MRI:"#6366f1", CTA:"#0891b2", MRA:"#7c3aed", "Add-on":"#64748b" };
const codeByCpt = Object.fromEntries(CODES.map(c => [c.cpt.replace("+",""), c]));

/* ============================== INSTITUTION LOOP ============================== */
const INSTITUTIONS = {
  UM:    { key:"UM",    label:"UHealth / UM", short:"UM",  color:"#f97316", match:/uhealth|university\s*of\s*miami|sylvester|bascom|\bum[a-z0-9\-_]*/i },
  JHS:   { key:"JHS",   label:"Jackson / JHS", short:"JHS", color:"#0ea5e9", match:/jackson|\bjhs\b|\bjhm\b|\bjmh\b|holtz|ryder/i },
  Other: { key:"Other", label:"Other / Unassigned", short:"Other", color:"#94a3b8", match:null },
};
function classifyInstitution(raw) {
  if (!raw) return "Other";
  const s = String(raw).trim();
  if (s === "UM" || s === "JHS" || s === "Other") return s;
  if (/^\s*um/i.test(s)) return "UM";                 // PRIMARY: any site starting with UM
  if (INSTITUTIONS.UM.match.test(s)) return "UM";
  if (INSTITUTIONS.JHS.match.test(s)) return "JHS";
  return "Other";
}
const instMeta = (k) => INSTITUTIONS[k] || INSTITUTIONS.Other;
function migrateLog(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(s => ({ ...s, items: (s.items || []).map(i => ({
    ...i, inst: classifyInstitution(i.inst), mod: i.mod || (codeByCpt[String(i.cpt).replace("+", "")]?.mod) || "CT",
  })) }));
}

/* ============================== BASELINE ==============================
   No seed data. Each user's reported baseline starts EMPTY and is stored
   per-user in the database (/api/store, scoped to the Clerk user id). Users
   build their own months in the Timeline tab; nothing is shared across users. */

const DEFAULTS = { ratePerWrvu: 78, cFTE: 1.0, monthlyBenchmark: 578, privateMult: 1.6, umYTD: 0, jhsYTD: 0 };

/* ============================== API ============================== */
async function callClaude(messages, { system, tools, maxTokens = 4000 } = {}) {
  // Calls our own server route, which holds the Anthropic key (never exposed to the browser).
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, system, tools, maxTokens }),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}
const textOf = (d) => (d.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
function parseJSON(raw) {
  const clean = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const s = clean.indexOf("["), e = clean.lastIndexOf("]"), so = clean.indexOf("{"), eo = clean.lastIndexOf("}");
  let slice = clean;
  if (s !== -1 && e !== -1) slice = clean.slice(s, e + 1); else if (so !== -1 && eo !== -1) slice = clean.slice(so, eo + 1);
  return JSON.parse(slice);
}
const toBase64 = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.onerror = rej; r.readAsDataURL(file); });

/* ============================== STORAGE ============================== */
async function loadKey(k, fb) {
  try {
    const r = await fetch(`/api/store?key=${encodeURIComponent(k)}`);
    if (!r.ok) return fb;
    const j = await r.json();
    return j && j.value != null ? j.value : fb;
  } catch { return fb; }
}
async function saveKey(k, v) {
  try {
    await fetch("/api/store", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: k, value: v }),
    });
  } catch {}
}

/* ============================== HELPERS ============================== */
const fmt = (n, d = 0) => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const monthKey = (iso) => iso.slice(0, 7);
const MONTH_LABEL = (k) => { const [y, m] = k.split("-"); return new Date(Number(y), Number(m) - 1, 1).toLocaleString("en-US", { month: "short", year: "2-digit" }); };

/* ============================================================================ ROOT ============================================================================ */
export default function NeuroRVU() {
  const [tab, setTab] = useState("tracker");
  const [exams, setExams] = useState([]);
  const [baseline, setBaseline] = useState([]);
  const [settings, setSettings] = useState(DEFAULTS);
  const [ready, setReady] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Exams are the source of truth (dedicated DB table), loaded per Clerk user.
  async function reloadExams() {
    try {
      const r = await fetch("/api/exams");
      if (r.ok) { const j = await r.json(); setExams(Array.isArray(j.exams) ? j.exams : []); }
    } catch {}
  }

  useEffect(() => {
    (async () => {
      await reloadExams();
      const bl = await loadKey("nrv_baseline", null);
      // Per-user only: load this user's saved baseline, otherwise start EMPTY.
      // No shared seed — a new user's timeline reflects only their own entries.
      setBaseline(Array.isArray(bl) ? bl : []);
      setSettings({ ...DEFAULTS, ...(await loadKey("nrv_settings", DEFAULTS)) });
      setReady(true);
    })();
  }, []);

  // Adapter: feed the existing per-month analytics/timeline/exams views from the
  // exams table. Each exam becomes a single-item "session" keyed by ITS OWN exam
  // date, so everything visualizes exams-per-date with zero churn downstream.
  const log = useMemo(() => exams.map((e) => ({
    id: e.id, batchId: e.batchId,
    date: (e.examDate ? String(e.examDate) : String(e.uploadedAt || "")).slice(0, 10),
    items: [{
      uid: e.id, cpt: e.cpt || "?", desc: e.procedure || "Study", mod: e.modality || "CT",
      count: 1, wrvu: Number(e.wrvu) || 0, est: !!e.estimated,
      inst: e.institution || classifyInstitution(e.site),
    }],
  })), [exams]);

  const updateBaseline = (n) => { setBaseline(n); saveKey("nrv_baseline", n); };
  const updateSettings = (n) => { setSettings(n); saveKey("nrv_settings", n); };

  if (!ready) return <div className="min-h-screen flex items-center justify-center bg-slate-50"><Loader2 className="w-6 h-6 animate-spin text-teal-600" /></div>;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900" style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif" }}>
      <header className="border-b border-slate-200 bg-white sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-teal-500 to-indigo-600 flex items-center justify-center"><Brain className="w-5 h-5 text-white" /></div>
            <div><div className="font-semibold tracking-tight leading-none">NeuroRVU</div><div className="text-[11px] text-slate-500 mt-0.5 font-mono">Neuroradiology productivity · CMS 2026</div></div>
          </div>
          <div className="flex items-center gap-1">
            <TabBtn active={tab === "tracker"} onClick={() => setTab("tracker")} icon={Activity}>Tracker</TabBtn>
            <TabBtn active={tab === "timeline"} onClick={() => setTab("timeline")} icon={LineIcon}>Timeline</TabBtn>
            <TabBtn active={tab === "exams"} onClick={() => setTab("exams")} icon={Layers}>Exams</TabBtn>
            <TabBtn active={tab === "uploads"} onClick={() => setTab("uploads")} icon={Upload}>Uploads</TabBtn>
            <TabBtn active={tab === "reference"} onClick={() => setTab("reference")} icon={Database}>Codes</TabBtn>
            <button onClick={() => setShowSettings(true)} className="ml-1 p-2 rounded-lg hover:bg-slate-100 text-slate-500"><SettingsIcon className="w-4 h-4" /></button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-5 py-6">
        {tab === "tracker" && <Tracker log={log} reloadExams={reloadExams} settings={settings} />}
        {tab === "timeline" && <Timeline baseline={baseline} updateBaseline={updateBaseline} log={log} settings={settings} />}
        {tab === "exams" && <ExamsView log={log} settings={settings} />}
        {tab === "uploads" && <UploadsView reloadExams={reloadExams} />}
        {tab === "reference" && <Reference settings={settings} />}
      </main>

      {showSettings && <SettingsDrawer settings={settings} onSave={updateSettings} onClose={() => setShowSettings(false)} />}

      <footer className="max-w-6xl mx-auto px-5 py-6 text-[11px] text-slate-400 leading-relaxed">
        Two data layers, one tool: <span className="text-slate-500 font-medium">Reported</span> (FY26 monthly baseline, authoritative) and <span className="text-slate-500 font-medium">Tracked</span> (your daily screenshot logs, granular).
        They measure the same work at different resolutions and are shown side by side — never summed. Institution loop: <span className="font-mono">UM*</span>/UHealth → UM, Jackson/JHS/JHM → JHS. Not official billing advice.
      </footer>
    </div>
  );
}

function TabBtn({ active, onClick, icon: Icon, children }) {
  return <button onClick={onClick} className={`px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors ${active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}><Icon className="w-4 h-4" />{children}</button>;
}

/* ============================== SHARED ============================== */
function InstitutionCards({ split, settings }) {
  const order = ["UM", "JHS", "Other"];
  const total = order.reduce((s, k) => s + split[k].wrvu, 0) || 1;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {order.map(k => {
        const inst = INSTITUTIONS[k], d = split[k], pct = (d.wrvu / total) * 100;
        return (
          <div key={k} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wide text-slate-400 flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5" style={{ color: inst.color }} />{inst.label}</span>
              <span className="text-[11px] font-mono text-slate-400">{fmt(pct, 0)}%</span>
            </div>
            <div className="mt-2 text-2xl font-bold font-mono tracking-tight">{fmt(d.wrvu, 0)}</div>
            <div className="mt-1 flex items-center justify-between text-[11px] text-slate-400"><span>{fmt(d.studies, 0)} studies</span><span className="font-mono">${fmt(d.wrvu * settings.ratePerWrvu, 0)}</span></div>
            <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: inst.color }} /></div>
          </div>
        );
      })}
    </div>
  );
}
function Kpi({ icon: Icon, label, value, sub, delta, good, accent }) {
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
function Empty({ msg }) { return <div className="h-40 flex flex-col items-center justify-center text-slate-400 gap-2"><Activity className="w-6 h-6" /><p className="text-sm">{msg || "No data yet."}</p></div>; }

/* ============================================================================ TIMELINE (merged) ============================================================================ */
function buildTimeline(baseline, log, settings) {
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

function Timeline({ baseline, updateBaseline, log, settings }) {
  const [view, setView] = useState("coverage"); // coverage | institution | reconcile
  const [editing, setEditing] = useState(false);
  const t = useMemo(() => buildTimeline(baseline, log, settings), [baseline, log, settings]);
  const C = { um: "#f97316", jhs: "#0ea5e9", base: "#0d9488", extra: "#5eead4", bench: "#6366f1", cum: "#0f172a", trk: "#0d9488" };
  const donut = [{ name: "UHealth / UM", value: settings.umYTD, color: C.um }, { name: "Jackson / JHS", value: settings.jhsYTD, color: C.jhs }];
  const instTotal = settings.umYTD + settings.jhsYTD;
  const instMismatch = Math.abs(instTotal - t.ytd.total) > 5;

  function editMonth(key, field, val) {
    updateBaseline(baseline.map(b => b.key === key ? { ...b, [field]: Number(val) || 0 } : b));
  }
  function addMonth() {
    const last = baseline[baseline.length - 1];
    const [y, m] = (last ? last.key : "2025-09").split("-").map(Number);
    const nm = m === 12 ? 1 : m + 1, ny = m === 12 ? y + 1 : y;
    const key = `${ny}-${String(nm).padStart(2, "0")}`;
    if (baseline.find(b => b.key === key)) return;
    updateBaseline([...baseline, { key, mo: MONTH_LABEL(key), cfte: settings.cFTE, bench: Math.round(settings.monthlyBenchmark * settings.cFTE), base: 0, extra: 0, pay: 0 }]);
  }
  function delMonth(key) { updateBaseline(baseline.filter(b => b.key !== key)); }
  function resetBaseline() { updateBaseline([]); }

  return (
    <div className="space-y-5">
      {/* Official YTD KPIs (from reported baseline) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={TrendingUp} label="YTD reported vs benchmark" value={fmt(t.ytd.base)} sub={`vs ${fmt(t.ytd.bench)} · +${fmt(t.ytd.variancePct, 0)}%`} good />
        <Kpi icon={Calendar} label="Total incl. extra coverage" value={fmt(t.ytd.total)} sub={`${fmt(t.ytd.base)} base + ${fmt(t.ytd.extra)} extra`} />
        <Kpi icon={DollarSign} label="Extra-coverage pay YTD" value={`$${fmt(t.ytd.pay)}`} sub="reported in source" accent />
        <Kpi icon={Building2} label="Institution split (YTD)" value={`${fmt(t.umShare * 100, 0)} / ${fmt(t.jhsShare * 100, 0)}`} sub={`UM ${fmt(settings.umYTD)} · JHS ${fmt(settings.jhsYTD)}`} />
      </div>

      {/* Chart */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <h2 className="font-semibold flex items-center gap-2">Productivity timeline
              <span className="text-[10px] font-normal text-emerald-600 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />reconciled</span>
            </h2>
            <p className="text-xs text-slate-500">Reported baseline + your tracked logs · dashed indigo = benchmark · black line = cumulative</p>
          </div>
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5 text-xs font-medium">
            <button onClick={() => setView("coverage")} className={`px-3 py-1.5 rounded-md ${view === "coverage" ? "bg-white shadow-sm text-slate-900" : "text-slate-500"}`}>Base vs extra</button>
            <button onClick={() => setView("institution")} className={`px-3 py-1.5 rounded-md ${view === "institution" ? "bg-white shadow-sm text-slate-900" : "text-slate-500"}`}>UM vs JHS*</button>
            <button onClick={() => setView("reconcile")} className={`px-3 py-1.5 rounded-md ${view === "reconcile" ? "bg-white shadow-sm text-slate-900" : "text-slate-500"}`}>Tracked vs reported</button>
          </div>
        </div>

        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={t.months} margin={{ top: 10, right: 12, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f6" />
              <XAxis dataKey="mo" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="l" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #e2e8f0" }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <ReferenceLine yAxisId="l" y={Math.round(settings.monthlyBenchmark * settings.cFTE)} stroke={C.bench} strokeDasharray="5 4" strokeWidth={1.5} />
              {view === "coverage" && <>
                <Bar yAxisId="l" dataKey="reported" name="Base actual" stackId="a" fill={C.base} />
                <Bar yAxisId="l" dataKey="extra" name="Extra coverage" stackId="a" fill={C.extra} radius={[5, 5, 0, 0]} />
                <Line yAxisId="r" type="monotone" dataKey="cumReported" name="Cumulative" stroke={C.cum} strokeWidth={2} dot={{ r: 2.5 }} />
              </>}
              {view === "institution" && <>
                <Bar yAxisId="l" dataKey="repUM" name="UHealth / UM*" stackId="a" fill={C.um} />
                <Bar yAxisId="l" dataKey="repJHS" name="Jackson / JHS*" stackId="a" fill={C.jhs} radius={[5, 5, 0, 0]} />
                <Line yAxisId="r" type="monotone" dataKey="cumReported" name="Cumulative" stroke={C.cum} strokeWidth={2} dot={{ r: 2.5 }} />
              </>}
              {view === "reconcile" && <>
                <Bar yAxisId="l" dataKey="reported" name="Reported (official)" fill={C.base} radius={[5, 5, 0, 0]} />
                <Bar yAxisId="l" dataKey="tracked" name="Tracked (your logs)" fill="#fbbf24" radius={[5, 5, 0, 0]} />
                <Line yAxisId="r" type="monotone" dataKey="cumReported" name="Cum. reported" stroke={C.cum} strokeWidth={2} dot={{ r: 2.5 }} />
              </>}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        {view === "institution" && <p className="text-[11px] text-amber-600 mt-2 flex items-start gap-1.5"><Info className="w-3.5 h-3.5 mt-px shrink-0" />* Monthly UM/JHS bars are a proportional estimate ({fmt(t.umShare * 100, 0)}% / {fmt(t.jhsShare * 100, 0)}%). The source reports the split only as a YTD total — only those totals (UM {fmt(settings.umYTD)} / JHS {fmt(settings.jhsYTD)}) are exact.</p>}
        {view === "reconcile" && <p className="text-[11px] text-slate-500 mt-2 flex items-start gap-1.5"><Info className="w-3.5 h-3.5 mt-px shrink-0" />Capture completeness = tracked ÷ reported. As you log more daily screenshots, the amber bars rise toward the official reported bars — the gap is what your self-tracking hasn't captured yet.</p>}
      </div>

      {/* Donut + reconcile table */}
      <div className="grid lg:grid-cols-3 gap-5">
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <h2 className="font-semibold mb-1">Institution split</h2>
          <p className="text-xs text-slate-500 mb-2">YTD total (exact, editable in Settings)</p>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart><Pie data={donut} dataKey="value" nameKey="name" innerRadius={40} outerRadius={60} paddingAngle={2}>{donut.map((d, i) => <Cell key={i} fill={d.color} />)}</Pie>
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #e2e8f0" }} formatter={(v) => `${fmt(v)} wRVU`} /></PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-1.5 mt-1">
            <InstRow dot={C.um} label="UHealth / UM" v={`${fmt(settings.umYTD)} · ${fmt(t.umShare * 100, 0)}%`} />
            <InstRow dot={C.jhs} label="Jackson / JHS" v={`${fmt(settings.jhsYTD)} · ${fmt(t.jhsShare * 100, 0)}%`} />
            <InstRow dot="#0f172a" label="Total" v={fmt(instTotal)} bold />
          </div>
          {instMismatch && <p className="text-[11px] text-amber-600 mt-2 flex items-start gap-1.5"><AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />UM+JHS ({fmt(instTotal)}) ≠ baseline total ({fmt(t.ytd.total)}). Update the YTD split in Settings when new months are added.</p>}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-5 lg:col-span-2 overflow-x-auto">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Reported baseline — monthly database</h2>
            <div className="flex items-center gap-1.5">
              <button onClick={() => setEditing(!editing)} className={`px-2.5 py-1 rounded-md text-xs font-medium ${editing ? "bg-teal-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{editing ? "Done" : "Edit"}</button>
              {editing && <><button onClick={addMonth} className="px-2.5 py-1 rounded-md text-xs font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 flex items-center gap-1"><Plus className="w-3 h-3" />Month</button>
                <button onClick={resetBaseline} className="px-2.5 py-1 rounded-md text-xs font-medium text-slate-500 hover:bg-slate-100 flex items-center gap-1"><RotateCcw className="w-3 h-3" />Reset</button></>}
            </div>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
              <th className="py-2 font-medium">Month</th><th className="py-2 font-medium text-right">Bench</th><th className="py-2 font-medium text-right">Actual</th>
              <th className="py-2 font-medium text-right">Var %</th><th className="py-2 font-medium text-right">Extra</th><th className="py-2 font-medium text-right">Total</th>
              <th className="py-2 font-medium text-right">Tracked</th>{editing && <th></th>}
            </tr></thead>
            <tbody className="font-mono">
              {t.months.filter(m => baseline.find(b => b.key === m.key)).map(m => (
                <tr key={m.key} className="border-b border-slate-50">
                  <td className="py-1.5 font-sans">{m.mo}</td>
                  <td className="py-1.5 text-right text-slate-500">{editing ? <NumCell v={m.bench} onChange={v => editMonth(m.key, "bench", v)} /> : fmt(m.bench)}</td>
                  <td className="py-1.5 text-right font-semibold">{editing ? <NumCell v={m.reported} onChange={v => editMonth(m.key, "base", v)} /> : fmt(m.reported)}</td>
                  <td className={`py-1.5 text-right ${m.variance >= 0 ? "text-emerald-600" : "text-amber-600"}`}>{m.variance >= 0 ? "+" : ""}{fmt(m.variancePct, 0)}%</td>
                  <td className="py-1.5 text-right text-teal-600">{editing ? <NumCell v={m.extra} onChange={v => editMonth(m.key, "extra", v)} /> : (m.extra ? fmt(m.extra) : "—")}</td>
                  <td className="py-1.5 text-right">{fmt(m.total)}</td>
                  <td className="py-1.5 text-right text-amber-600">{m.tracked ? `${fmt(m.tracked)} (${fmt(m.capture, 0)}%)` : "—"}</td>
                  {editing && <td className="py-1.5 text-right"><button onClick={() => delMonth(m.key)} className="text-slate-300 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button></td>}
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t-2 border-slate-200 font-mono">
              <td className="py-2 font-sans font-semibold">YTD</td><td className="py-2 text-right text-slate-500">{fmt(t.ytd.bench)}</td>
              <td className="py-2 text-right font-bold">{fmt(t.ytd.base)}</td><td className="py-2 text-right text-emerald-600 font-semibold">+{fmt(t.ytd.variancePct, 0)}%</td>
              <td className="py-2 text-right text-teal-600 font-semibold">{fmt(t.ytd.extra)}</td><td className="py-2 text-right font-bold">{fmt(t.ytd.total)}</td>
              <td className="py-2 text-right"></td>{editing && <td></td>}
            </tr></tfoot>
          </table>
          <p className="text-[11px] text-slate-400 mt-3 flex items-start gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 mt-px shrink-0 text-emerald-500" />"Tracked" shows your daily-log capture vs each reported month. Add or edit your reported months above to reconcile your own data against benchmark.</p>
        </div>
      </div>
    </div>
  );
}
function InstRow({ dot, label, v, bold }) {
  return <div className="flex items-center gap-2 text-sm"><span className="w-2 h-2 rounded-full" style={{ background: dot }} /><span className={`flex-1 ${bold ? "font-semibold" : "text-slate-600"}`}>{label}</span><span className={`font-mono text-xs ${bold ? "font-bold" : ""}`}>{v}</span></div>;
}
function NumCell({ v, onChange }) {
  return <input type="number" value={v} onChange={e => onChange(e.target.value)} className="w-16 text-right border border-slate-200 rounded px-1 py-0.5 text-xs font-mono focus:border-teal-400 outline-none" />;
}

/* ============================================================================ TRACKER ============================================================================ */
function Tracker({ log, reloadExams, settings }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [draft, setDraft] = useState(null);
  const [manualDate, setManualDate] = useState(new Date().toISOString().slice(0, 10));
  const [curInst, setCurInst] = useState("UM");
  const fileRef = useRef();

  async function handleFiles(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setBusy(true); setStatus(`Reading ${files.length} screenshot${files.length > 1 ? "s" : ""}…`);
    try {
      const imgs = await Promise.all(files.map(async f => ({ type: "image", source: { type: "base64", media_type: f.type || "image/png", data: await toBase64(f) } })));
      const data = await callClaude([{ role: "user", content: [...imgs, { type: "text", text: extractionUserText }] }], { system: extractionSystemPrompt(), maxTokens: 8000 });
      // Response is an object: {valid:true, exams:[...]} OR {valid:false, reason:"..."}
      const rawText = textOf(data).replace(/```json/gi, "").replace(/```/g, "").trim();
      const so = rawText.indexOf("{"), eo = rawText.lastIndexOf("}");
      const parsed = JSON.parse(so !== -1 ? rawText.slice(so, eo + 1) : rawText);

      if (parsed && parsed.valid === false) {
        setDraft(null);
        setStatus(parsed.reason || "This doesn't look like an exam worklist (it needs Site, Procedure, and Exam Date columns). Please upload a worklist or RVU report screenshot.");
        return;
      }
      const arr = Array.isArray(parsed?.exams) ? parsed.exams : [];
      let uidc = Date.now();
      const items = arr.map(x => {
        const canon = codeByCpt[String(x.cpt).replace("+", "")];
        const detected = classifyInstitution(x.site || x.institution);
        const inst = detected === "Other" ? curInst : detected;
        const wrvu = canon ? canon.wrvu : (Number(x.wrvu_each) || 0);
        const day = (x.exam_date ? String(x.exam_date) : "").slice(0, 10) || manualDate;
        return {
          uid: ++uidc, cpt: String(x.cpt || "?"),
          desc: x.procedure || (canon ? `${canon.desc} ${canon.con}` : "Unrecognized study"),
          mod: canon ? canon.mod : (x.modality || "CT"),
          wrvu, est: canon ? !!canon.est : true, inst, site: x.site || "",
          date: day, examDate: x.exam_date || `${day}T00:00:00`, needsPrice: !(wrvu > 0),
        };
      });
      if (!items.length) { setDraft(null); setStatus("No exams detected. Try a clearer screenshot or add manually."); }
      else {
        const unpriced = items.filter(i => i.needsPrice).length;
        const dates = [...new Set(items.map(i => i.date))].sort();
        setDraft({ batchId: `batch_${Date.now()}`, source: "screenshot", items });
        setStatus(`Detected ${items.length} exams across ${dates.length} date${dates.length > 1 ? "s" : ""}.` + (unpriced ? ` ${unpriced} need a code below.` : " Review and save."));
      }
    } catch { setStatus("Extraction failed — the image may be unreadable. Add exams manually instead."); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  function addManual(code) {
    setDraft(d => {
      const base = d || { batchId: `batch_${Date.now()}`, source: "manual", items: [] };
      const item = { uid: Date.now() + Math.random(), cpt: code.cpt, desc: `${code.desc} ${code.con}`, mod: code.mod,
        wrvu: code.wrvu, est: !!code.est, inst: curInst, site: "", date: manualDate, examDate: `${manualDate}T00:00:00`, needsPrice: false };
      return { ...base, items: [...base.items, item] };
    });
  }
  function removeDraftItem(it) { setDraft(d => { const items = d.items.filter(i => i.uid !== it.uid); return items.length ? { ...d, items } : null; }); }
  function cycleInst(it) { const order = ["UM", "JHS", "Other"]; setDraft(d => ({ ...d, items: d.items.map(i => i.uid === it.uid ? { ...i, inst: order[(order.indexOf(i.inst) + 1) % 3] } : i) })); }
  function assignCode(it, code) { setDraft(d => ({ ...d, items: d.items.map(i => i.uid === it.uid ? { ...i, cpt: code.cpt, desc: `${code.desc} ${code.con}`, mod: code.mod, wrvu: code.wrvu, est: !!code.est, needsPrice: false } : i) })); }
  async function commitDraft() {
    if (!draft || !draft.items.length) return;
    setBusy(true);
    try {
      const payload = {
        batchId: draft.batchId || `batch_${Date.now()}`,
        source: draft.source || "screenshot",
        exams: draft.items.map(i => ({
          examDate: i.examDate || (i.date ? `${i.date}T00:00:00` : null),
          cpt: i.cpt, procedure: i.desc, site: i.site || "",
          institution: i.inst, modality: i.mod, wrvu: i.wrvu, estimated: i.est,
        })),
      };
      const r = await fetch("/api/exams", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!r.ok) { setStatus("Save failed — please try again."); return; }
      const left = draft.items.filter(i => i.needsPrice).length;
      setDraft(null);
      await reloadExams();
      setStatus(left ? `Saved. ${left} exam(s) stored at 0 wRVU — assign codes to count their value.` : `Saved ${payload.exams.length} exams to your database.`);
    } catch { setStatus("Save failed — please try again."); }
    finally { setBusy(false); }
  }

  const a = useMemo(() => buildAnalytics(log, settings), [log, settings]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={Calendar} label="Tracked this month" value={fmt(a.thisMonth.actual, 0)} sub={`vs ${fmt(a.thisMonth.bench, 0)} target`} delta={a.thisMonth.variancePct} />
        <Kpi icon={TrendingUp} label="Tracked YTD" value={fmt(a.ytd.actual, 0)} sub={`${fmt(a.ytd.studies, 0)} studies logged`} />
        <Kpi icon={Target} label="Annual projection" value={fmt(a.annual.projected, 0)} sub={`vs ${fmt(a.annual.bench, 0)} target`} delta={a.annual.variancePct} />
        <Kpi icon={DollarSign} label="Tracked comp value" value={`$${fmt(a.ytd.actual * settings.ratePerWrvu, 0)}`} sub={`@ $${settings.ratePerWrvu}/wRVU`} accent />
      </div>

      <div>
        <div className="flex items-center gap-2 mb-2"><Building2 className="w-4 h-4 text-slate-500" /><h2 className="font-semibold">Tracked institution split — accumulated wRVU</h2></div>
        <InstitutionCards split={a.institution} settings={settings} />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-teal-600" /><h2 className="font-semibold">Log a session</h2></div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
              {["UM", "JHS", "Other"].map(k => <button key={k} onClick={() => setCurInst(k)} className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${curInst === k ? "bg-white shadow-sm" : "text-slate-500"}`} style={curInst === k ? { color: INSTITUTIONS[k].color } : {}}>{INSTITUTIONS[k].short}</button>)}
            </div>
            <label className="text-xs text-slate-500 flex items-center gap-2">Date<input type="date" value={manualDate} onChange={e => setManualDate(e.target.value)} className="border border-slate-200 rounded-md px-2 py-1 text-xs font-mono" /></label>
          </div>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <input ref={fileRef} type="file" accept="image/*" multiple onChange={handleFiles} className="hidden" id="shot" />
            <label htmlFor="shot" className="cursor-pointer flex flex-col items-center justify-center gap-2 h-32 rounded-xl border-2 border-dashed border-slate-300 hover:border-teal-400 hover:bg-teal-50/40 transition-colors">
              {busy ? <><Loader2 className="w-5 h-5 animate-spin text-teal-600" /><span className="text-sm text-slate-500">{status}</span></>
                : <><Upload className="w-5 h-5 text-slate-400" /><span className="text-sm text-slate-600 font-medium">Drop or upload daily productivity screenshots</span><span className="text-[11px] text-slate-400">AI extracts studies, wRVU & detects site (default: {curInst})</span></>}
            </label>
            {/* Direct camera capture — on phones this opens the rear camera straight into OCR. */}
            <input type="file" accept="image/*" capture="environment" multiple onChange={handleFiles} className="hidden" id="cam" />
            <label htmlFor="cam" className="mt-2 cursor-pointer flex items-center justify-center gap-2 h-10 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition-colors">
              <Camera className="w-4 h-4" /> Take photo
            </label>
          </div>
          <ManualAdd onAdd={addManual} />
        </div>
        {status && !busy && <div className="mt-3 text-xs text-slate-500 flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 text-teal-500" />{status}</div>}

        {draft && (
          <div className="mt-4 rounded-xl border border-teal-200 bg-teal-50/50 p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium text-teal-900 flex items-center gap-2"><FileImage className="w-4 h-4" />Review — {draft.items.length} exams · {draft.source}</div>
              <div className="text-xs font-mono text-teal-700">{fmt(draft.items.reduce((s, i) => s + i.wrvu, 0), 2)} wRVU</div>
            </div>
            <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
              {draft.items.map(i => (
                <div key={i.uid} className={`flex items-center gap-2 text-sm rounded-lg px-3 py-1.5 border ${i.needsPrice ? "bg-amber-50 border-amber-200" : "bg-white border-teal-100"}`}>
                  <span className="font-mono text-[10px] text-slate-400 w-[68px] shrink-0">{i.date}</span>
                  <span className="font-mono text-xs text-slate-500 w-14 shrink-0">{i.cpt}</span>
                  <span className="flex-1 truncate">{i.desc}{i.est && !i.needsPrice && <span className="text-amber-500 text-[10px] ml-1">est.</span>}{i.needsPrice && <span className="text-amber-600 text-[10px] ml-1 font-semibold uppercase tracking-wide">needs code</span>}</span>
                  {i.needsPrice && <CodeAssign onPick={(c) => assignCode(i, c)} />}
                  <button onClick={() => cycleInst(i)} className="text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0" style={{ background: instMeta(i.inst).color + "22", color: instMeta(i.inst).color }}>{instMeta(i.inst).short}</button>
                  <span className="font-mono text-xs text-slate-400 w-12 text-right shrink-0">{i.wrvu.toFixed(2)}</span>
                  <button onClick={() => removeDraftItem(i)} className="text-slate-300 hover:text-red-500 shrink-0"><X className="w-3.5 h-3.5" /></button>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 mt-3 items-center">
              <button onClick={commitDraft} disabled={busy} className="px-4 py-1.5 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 disabled:opacity-50 flex items-center gap-1.5"><Check className="w-4 h-4" />Save {draft.items.length} exams</button>
              <button onClick={() => setDraft(null)} className="px-3 py-1.5 rounded-lg text-slate-500 text-sm hover:bg-slate-100">Discard</button>
              <span className="text-[11px] text-slate-400">Each row is one exam with its own date. Tap the site badge to reassign. Amber rows need a code.</span>
            </div>
          </div>
        )}
      </div>

      {log.length > 0 && (
        <p className="text-xs text-slate-400 px-1 flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5" />{log.length} exams in your database. View them in the <span className="font-medium text-slate-600">Exams</span> tab, or manage / delete uploads in the <span className="font-medium text-slate-600">Uploads</span> tab.
        </p>
      )}
    </div>
  );
}

/* ============================================================================ UPLOADS ============================================================================ */
function UploadsView({ reloadExams }) {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [examDay, setExamDay] = useState("");
  const [uploadDay, setUploadDay] = useState("");
  const [confirm, setConfirm] = useState(null);

  async function load() {
    setLoading(true);
    try { const r = await fetch("/api/exams?batches=1"); const j = await r.json(); setBatches(Array.isArray(j.batches) ? j.batches : []); }
    catch {} finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function del(params, label) {
    setBusy(true); setStatus("");
    try {
      const r = await fetch(`/api/exams?${params}`, { method: "DELETE" });
      const j = await r.json();
      if (r.ok) { setStatus(`Deleted ${j.deleted ?? 0} exam${j.deleted === 1 ? "" : "s"}${label ? ` · ${label}` : ""}.`); await load(); await reloadExams?.(); }
      else setStatus(j.error || "Delete failed.");
    } catch { setStatus("Delete failed."); }
    finally { setBusy(false); setConfirm(null); }
  }

  const ts = (d) => d ? new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
  const day = (d) => d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" }) : "—";

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="font-semibold flex items-center gap-2 mb-1"><Calendar className="w-4 h-4 text-slate-500" />Delete by day</h2>
        <p className="text-xs text-slate-400 mb-4">Remove exams by the date shown on the exam, or by the day you uploaded them.</p>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="flex items-end gap-2">
            <label className="flex-1 text-xs text-slate-500">By exam date
              <input type="date" value={examDay} onChange={e => setExamDay(e.target.value)} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono" /></label>
            <button disabled={!examDay || busy} onClick={() => del(`examDate=${examDay}`, `exam date ${examDay}`)} className="px-3 py-2 rounded-lg bg-red-500 text-white text-sm font-medium hover:bg-red-600 disabled:opacity-40">Delete</button>
          </div>
          <div className="flex items-end gap-2">
            <label className="flex-1 text-xs text-slate-500">By upload date
              <input type="date" value={uploadDay} onChange={e => setUploadDay(e.target.value)} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono" /></label>
            <button disabled={!uploadDay || busy} onClick={() => del(`uploadDate=${uploadDay}`, `upload date ${uploadDay}`)} className="px-3 py-2 rounded-lg bg-red-500 text-white text-sm font-medium hover:bg-red-600 disabled:opacity-40">Delete</button>
          </div>
        </div>
        {status && <p className="mt-3 text-xs text-slate-500 flex items-center gap-1.5"><Info className="w-3.5 h-3.5" />{status}</p>}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold flex items-center gap-2"><Layers className="w-4 h-4 text-slate-500" />Uploaded batches</h2>
          <span className="text-xs text-slate-400">{batches.length} batch{batches.length === 1 ? "" : "es"}</span>
        </div>
        {loading ? <div className="py-10 text-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
          : batches.length === 0 ? <div className="py-10 text-center text-slate-400 text-sm"><Layers className="w-6 h-6 mx-auto mb-2" />No uploads yet. Add exams in the Tracker tab.</div>
          : (
            <div className="space-y-2">
              {batches.map(b => (
                <div key={b.batchId} className="flex flex-wrap items-center gap-3 text-sm rounded-xl border border-slate-100 px-4 py-3 hover:bg-slate-50">
                  <div className="flex-1 min-w-[200px]">
                    <div className="font-medium text-slate-800">{b.count} exam{b.count === 1 ? "" : "s"} · {fmt(b.wrvu, 1)} wRVU</div>
                    <div className="text-xs text-slate-400">Uploaded {ts(b.uploadedAt)} · exam dates {day(b.firstExam)}{b.firstExam !== b.lastExam ? `–${day(b.lastExam)}` : ""}{b.sites?.length ? ` · ${b.sites.join(", ")}` : ""}</div>
                  </div>
                  {confirm === b.batchId ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-red-500">Delete {b.count}?</span>
                      <button onClick={() => del(`batchId=${encodeURIComponent(b.batchId)}`, "batch")} className="px-2.5 py-1 rounded-md bg-red-500 text-white text-xs font-medium">Yes</button>
                      <button onClick={() => setConfirm(null)} className="px-2.5 py-1 rounded-md text-slate-500 text-xs hover:bg-slate-100">Cancel</button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirm(b.batchId)} className="inline-flex items-center gap-1 text-xs text-red-500 border border-red-200 rounded-md px-2.5 py-1 hover:bg-red-50"><Trash2 className="w-3.5 h-3.5" />Delete cluster</button>
                  )}
                </div>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}

function CodeAssign({ onPick }) {
  const [q, setQ] = useState("");
  const results = useMemo(() => { if (!q.trim()) return []; const t = q.toLowerCase(); return CODES.filter(c => c.cpt.includes(t) || c.desc.toLowerCase().includes(t) || c.region.toLowerCase().includes(t)).slice(0, 5); }, [q]);
  return (
    <div className="relative">
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="assign code…" className="text-xs border border-amber-300 bg-white rounded px-2 py-1 w-28 outline-none focus:border-amber-500" />
      {results.length > 0 && (
        <div className="absolute z-20 mt-1 w-64 right-0 bg-white border border-slate-200 rounded-lg shadow-lg p-1">
          {results.map(c => <button key={c.cpt} onClick={() => { onPick(c); setQ(""); }} className="w-full flex items-center gap-2 text-left text-xs px-2 py-1 rounded hover:bg-teal-50"><span className="font-mono text-slate-400 w-12">{c.cpt}</span><span className="flex-1 truncate">{c.desc} {c.con}</span><span className="font-mono">{c.wrvu.toFixed(2)}</span></button>)}
        </div>
      )}
    </div>
  );
}
function ManualAdd({ onAdd }) {
  const [q, setQ] = useState("");
  const results = useMemo(() => { if (!q.trim()) return []; const t = q.toLowerCase(); return CODES.filter(c => c.cpt.includes(t) || c.desc.toLowerCase().includes(t) || c.region.toLowerCase().includes(t) || c.mod.toLowerCase() === t).slice(0, 7); }, [q]);
  return (
    <div className="relative">
      <div className="flex items-center gap-2 h-32 rounded-xl border border-slate-200 bg-slate-50/60 p-3 flex-col justify-start">
        <div className="w-full flex items-center gap-2 bg-white rounded-lg border border-slate-200 px-3 py-2"><Search className="w-4 h-4 text-slate-400" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Quick add by CPT, name, or modality…" className="flex-1 text-sm outline-none bg-transparent" /></div>
        <div className="w-full flex-1 overflow-y-auto space-y-1">
          {results.map(c => <button key={c.cpt} onClick={() => { onAdd(c); setQ(""); }} className="w-full flex items-center gap-2 text-left text-sm px-2 py-1 rounded hover:bg-teal-50"><span className="font-mono text-xs text-slate-400 w-12">{c.cpt}</span><span className="flex-1 truncate">{c.desc} <span className="text-slate-400">{c.con}</span></span><span className="font-mono text-xs">{c.wrvu.toFixed(2)}</span><Plus className="w-3.5 h-3.5 text-teal-500" /></button>)}
          {q && !results.length && <div className="text-xs text-slate-400 px-2 py-2">No match.</div>}
        </div>
      </div>
    </div>
  );
}

/* ============================================================================ ANALYTICS (tracked) ============================================================================ */
function buildAnalytics(log, settings) {
  const byMonth = {}, institution = { UM: { wrvu: 0, studies: 0 }, JHS: { wrvu: 0, studies: 0 }, Other: { wrvu: 0, studies: 0 } }, byType = {};
  for (const s of log) {
    const k = monthKey(s.date); byMonth[k] = byMonth[k] || { wrvu: 0, studies: 0, um: 0, jhs: 0 };
    for (const i of s.items) {
      const w = i.count * i.wrvu; byMonth[k].wrvu += w; byMonth[k].studies += i.count;
      const site = classifyInstitution(i.inst); institution[site].wrvu += w; institution[site].studies += i.count;
      if (site === "UM") byMonth[k].um += w; if (site === "JHS") byMonth[k].jhs += w;
      if (!byType[i.cpt]) { const canon = codeByCpt[i.cpt.replace("+", "")] || {}; byType[i.cpt] = { cpt: i.cpt, desc: i.desc, mod: i.mod || canon.mod || "CT", perStudy: i.wrvu, count: 0, wrvu: 0, byInst: {} }; }
      byType[i.cpt].count += i.count; byType[i.cpt].wrvu += w;
      byType[i.cpt].byInst[site] = byType[i.cpt].byInst[site] || { count: 0, wrvu: 0 };
      byType[i.cpt].byInst[site].count += i.count; byType[i.cpt].byInst[site].wrvu += w;
    }
  }
  const keys = Object.keys(byMonth).sort();
  const months = keys.map(k => { const d = byMonth[k], bench = settings.monthlyBenchmark * settings.cFTE, variance = d.wrvu - bench; return { key: k, label: MONTH_LABEL(k), actual: d.wrvu, bench, studies: d.studies, um: d.um, jhs: d.jhs, variance, variancePct: bench ? (variance / bench) * 100 : 0 }; });
  const nowKey = new Date().toISOString().slice(0, 7), tm = byMonth[nowKey] || { wrvu: 0 }, tmBench = settings.monthlyBenchmark * settings.cFTE;
  const thisMonth = { actual: tm.wrvu, bench: tmBench, variancePct: tmBench ? ((tm.wrvu - tmBench) / tmBench) * 100 : 0 };
  const ytdActual = months.reduce((s, m) => s + m.actual, 0), ytdStudies = months.reduce((s, m) => s + m.studies, 0), ytdBench = months.reduce((s, m) => s + m.bench, 0);
  const ytd = { actual: ytdActual, studies: ytdStudies, bench: ytdBench, variance: ytdActual - ytdBench, variancePct: ytdBench ? ((ytdActual - ytdBench) / ytdBench) * 100 : 0 };
  const monthsElapsed = Math.max(months.length, 1), projected = (ytdActual / monthsElapsed) * 12, annualBench = settings.monthlyBenchmark * 12 * settings.cFTE;
  const annual = { projected, bench: annualBench, variancePct: annualBench ? ((projected - annualBench) / annualBench) * 100 : 0 };
  return { months, thisMonth, ytd, annual, institution, byType };
}

/* ============================================================================ EXAMS DATABASE ============================================================================ */
function ExamsView({ log, settings }) {
  const [q, setQ] = useState(""); const [mod, setMod] = useState("ALL"); const [inst, setInst] = useState("ALL"); const [sort, setSort] = useState("wrvu");
  const mods = ["ALL", "CT", "CTA", "MRI", "MRA", "Add-on"];
  const a = useMemo(() => buildAnalytics(log, settings), [log, settings]);
  const rows = useMemo(() => {
    const t = q.toLowerCase();
    let r = Object.values(a.byType).filter(x => {
      const c = codeByCpt[x.cpt.replace("+", "")] || {};
      return (mod === "ALL" || x.mod === mod) && (inst === "ALL" || (x.byInst[inst] && x.byInst[inst].count > 0)) &&
        (!t || x.cpt.includes(t) || x.desc.toLowerCase().includes(t) || (c.region || "").toLowerCase().includes(t) || x.mod.toLowerCase() === t);
    });
    r.sort((a, b) => sort === "wrvu" ? b.wrvu - a.wrvu : sort === "count" ? b.count - a.count : a.cpt.localeCompare(b.cpt));
    return r;
  }, [a, q, mod, inst, sort]);
  const totals = useMemo(() => rows.reduce((s, r) => ({ count: s.count + (inst === "ALL" ? r.count : (r.byInst[inst]?.count || 0)), wrvu: s.wrvu + (inst === "ALL" ? r.wrvu : (r.byInst[inst]?.wrvu || 0)) }), { count: 0, wrvu: 0 }), [rows, inst]);

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2 mb-2"><Building2 className="w-4 h-4 text-slate-500" /><h2 className="font-semibold">Tracked wRVU by institution</h2></div>
        <InstitutionCards split={a.institution} settings={settings} />
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <div className="flex flex-col lg:flex-row gap-3 lg:items-center">
          <div className="flex-1 flex items-center gap-2 bg-slate-50 rounded-lg border border-slate-200 px-3 py-2"><Search className="w-4 h-4 text-slate-400" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search uploaded exams — CPT, name, region, modality…" className="flex-1 text-sm outline-none bg-transparent" /></div>
          <div className="flex flex-wrap gap-1">
            {mods.map(m => <button key={m} onClick={() => setMod(m)} className={`px-2.5 py-1.5 rounded-lg text-xs font-medium ${mod === m ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{m}</button>)}
            <span className="w-px bg-slate-200 mx-1" />
            {["ALL", "UM", "JHS", "Other"].map(k => <button key={k} onClick={() => setInst(k)} className={`px-2.5 py-1.5 rounded-lg text-xs font-medium ${inst === k ? "text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`} style={inst === k ? { background: k === "ALL" ? "#0f172a" : INSTITUTIONS[k].color } : {}}>{k === "ALL" ? "All sites" : INSTITUTIONS[k].short}</button>)}
          </div>
        </div>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {Object.keys(a.byType).length === 0 ? <div className="py-12 text-center text-slate-400"><Layers className="w-6 h-6 mx-auto mb-2" /><p className="text-sm">No exams uploaded yet. Log sessions in the Tracker tab.</p></div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-200 bg-slate-50/60">
                <th className="py-2.5 px-4 font-medium">Exam type</th><th className="py-2.5 px-2 font-medium">CPT</th><th className="py-2.5 px-2 font-medium">Mod</th>
                <th className="py-2.5 px-2 font-medium text-right cursor-pointer" onClick={() => setSort("count")}>Count{sort === "count" && " ↓"}</th>
                <th className="py-2.5 px-2 font-medium text-right" style={{ color: INSTITUTIONS.UM.color }}>UM</th><th className="py-2.5 px-2 font-medium text-right" style={{ color: INSTITUTIONS.JHS.color }}>JHS</th>
                <th className="py-2.5 px-2 font-medium text-right">wRVU/ea</th><th className="py-2.5 px-2 font-medium text-right cursor-pointer" onClick={() => setSort("wrvu")}>Σ wRVU{sort === "wrvu" && " ↓"}</th><th className="py-2.5 px-4 font-medium text-right">Comp $</th>
              </tr></thead>
              <tbody>
                {rows.map(r => { const showCount = inst === "ALL" ? r.count : (r.byInst[inst]?.count || 0), showWrvu = inst === "ALL" ? r.wrvu : (r.byInst[inst]?.wrvu || 0);
                  return (
                    <tr key={r.cpt} className="border-b border-slate-50 hover:bg-slate-50/60">
                      <td className="py-2 px-4"><span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full" style={{ background: MOD_COLORS[r.mod] || "#94a3b8" }} />{r.desc}</span></td>
                      <td className="py-2 px-2 font-mono text-xs">{r.cpt}</td><td className="py-2 px-2 text-xs text-slate-500">{r.mod}</td>
                      <td className="py-2 px-2 text-right font-mono font-semibold">{fmt(showCount, 0)}</td>
                      <td className="py-2 px-2 text-right font-mono text-xs" style={{ color: INSTITUTIONS.UM.color }}>{r.byInst.UM ? fmt(r.byInst.UM.count, 0) : "—"}</td>
                      <td className="py-2 px-2 text-right font-mono text-xs" style={{ color: INSTITUTIONS.JHS.color }}>{r.byInst.JHS ? fmt(r.byInst.JHS.count, 0) : "—"}</td>
                      <td className="py-2 px-2 text-right font-mono text-slate-400 text-xs">{r.perStudy.toFixed(2)}</td>
                      <td className="py-2 px-2 text-right font-mono font-semibold">{fmt(showWrvu, 1)}</td>
                      <td className="py-2 px-4 text-right font-mono text-slate-600">${fmt(showWrvu * settings.ratePerWrvu, 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr className="border-t-2 border-slate-200 font-mono bg-slate-50/50">
                <td className="py-2.5 px-4 font-sans font-semibold" colSpan={3}>{rows.length} exam types · {inst === "ALL" ? "all sites" : instMeta(inst).label}</td>
                <td className="py-2.5 px-2 text-right font-bold">{fmt(totals.count, 0)}</td><td colSpan={3}></td>
                <td className="py-2.5 px-2 text-right font-bold">{fmt(totals.wrvu, 1)}</td><td className="py-2.5 px-4 text-right font-bold">${fmt(totals.wrvu * settings.ratePerWrvu, 0)}</td>
              </tr></tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================================ CODES REFERENCE ============================================================================ */
function Reference({ settings }) {
  const [q, setQ] = useState(""); const [mod, setMod] = useState("ALL"); const [live, setLive] = useState({});
  const mods = ["ALL", "CT", "CTA", "MRI", "MRA", "Add-on"];
  const rows = useMemo(() => { const t = q.toLowerCase(); return CODES.filter(c => (mod === "ALL" || c.mod === mod) && (!t || c.cpt.includes(t) || c.desc.toLowerCase().includes(t) || c.region.toLowerCase().includes(t))); }, [q, mod]);
  async function lookup(c) {
    setLive(s => ({ ...s, [c.cpt]: { loading: true } }));
    try {
      const data = await callClaude([{ role: "user", content: `For CPT ${c.cpt} (${c.desc} ${c.con}), give CURRENT 2026 values: (1) work RVU, (2) Florida Medicare professional-component (mod 26) payment USD, (3) typical commercial/private professional-component payment USD at a Florida academic center (e.g., University of Miami / Jackson). Use web search. Respond ONLY JSON: {"wrvu":0,"medicare_fl":0,"private":0,"note":"short"}` }], { tools: [{ type: "web_search_20250305", name: "web_search" }], maxTokens: 1500 });
      setLive(s => ({ ...s, [c.cpt]: { loading: false, data: parseJSON(textOf(data)) } }));
    } catch { setLive(s => ({ ...s, [c.cpt]: { loading: false, error: true } })); }
  }
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
          <div className="flex-1 flex items-center gap-2 bg-slate-50 rounded-lg border border-slate-200 px-3 py-2"><Search className="w-4 h-4 text-slate-400" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search CPT, exam, or region…" className="flex-1 text-sm outline-none bg-transparent" /></div>
          <div className="flex flex-wrap gap-1">{mods.map(m => <button key={m} onClick={() => setMod(m)} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${mod === m ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{m}</button>)}</div>
        </div>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-200 bg-slate-50/60">
              <th className="py-2.5 px-4 font-medium">CPT</th><th className="py-2.5 px-2 font-medium">Exam</th><th className="py-2.5 px-2 font-medium">Con.</th><th className="py-2.5 px-2 font-medium text-right">wRVU</th><th className="py-2.5 px-2 font-medium text-right">Comp $</th><th className="py-2.5 px-2 font-medium text-right">Live value</th>
            </tr></thead>
            <tbody>
              {rows.map(c => { const L = live[c.cpt]; return (
                <tr key={c.cpt} className="border-b border-slate-50 hover:bg-slate-50/60">
                  <td className="py-2 px-4 font-mono text-xs"><span className="font-semibold">{c.cpt}</span>{c.flag && <span className="ml-1.5 text-[9px] px-1 py-0.5 rounded bg-indigo-100 text-indigo-600 align-middle">{c.flag}</span>}</td>
                  <td className="py-2 px-2"><span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full" style={{ background: MOD_COLORS[c.mod] || "#94a3b8" }} />{c.desc}</span></td>
                  <td className="py-2 px-2 font-mono text-xs text-slate-500">{c.con}</td>
                  <td className="py-2 px-2 text-right font-mono font-semibold">{c.wrvu.toFixed(2)}{c.est && <span className="text-amber-500 text-[10px] ml-1">est.</span>}</td>
                  <td className="py-2 px-2 text-right font-mono text-slate-600">${fmt(c.wrvu * settings.ratePerWrvu, 0)}</td>
                  <td className="py-2 px-2 text-right">
                    {L?.loading ? <Loader2 className="w-4 h-4 animate-spin text-teal-600 inline" />
                      : L?.data ? <div className="text-[11px] font-mono leading-tight text-right"><div className="text-emerald-600">wRVU {L.data.wrvu ?? "—"}</div><div className="text-slate-500">FL Mcr ${L.data.medicare_fl ?? "—"}</div><div className="text-indigo-600">Priv ${L.data.private ?? "—"}</div></div>
                      : L?.error ? <button onClick={() => lookup(c)} className="text-[11px] text-red-400 hover:text-red-600">retry</button>
                      : <button onClick={() => lookup(c)} className="text-[11px] font-medium text-teal-600 hover:text-teal-700 flex items-center gap-1 ml-auto"><Sparkles className="w-3 h-3" />lookup</button>}
                  </td>
                </tr>
              ); })}
            </tbody>
          </table>
        </div>
        {!rows.length && <div className="py-10 text-center text-sm text-slate-400">No codes match.</div>}
      </div>
      <p className="text-[11px] text-slate-400 px-1"><span className="text-teal-600 font-medium">Live value</span> queries current Florida Medicare + private/UM-style commercial rates via web search. Static Comp $ = wRVU × your ${settings.ratePerWrvu}/wRVU rate.</p>
    </div>
  );
}

/* ============================================================================ SETTINGS ============================================================================ */
function SettingsDrawer({ settings, onSave, onClose }) {
  const [s, setS] = useState(settings);
  const field = (k, label, sub, step = 1) => (
    <div><label className="text-sm font-medium text-slate-700">{label}</label>{sub && <p className="text-[11px] text-slate-400 mb-1">{sub}</p>}
      <input type="number" step={step} value={s[k]} onChange={e => setS({ ...s, [k]: Number(e.target.value) })} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono mt-1" /></div>
  );
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-white h-full shadow-xl p-6 overflow-y-auto">
        <div className="flex items-center justify-between mb-5"><h2 className="font-semibold text-lg">Settings</h2><button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><X className="w-4 h-4" /></button></div>
        <div className="space-y-4">
          {field("ratePerWrvu", "Your $/wRVU rate", "FY26 extra-coverage rate ≈ $78")}
          {field("monthlyBenchmark", "Monthly benchmark (1.0 cFTE)", "AAARAD 65th ≈ 578 wRVU")}
          {field("cFTE", "Current clinical FTE", "Scales monthly + annual targets", 0.01)}
          {field("privateMult", "Private vs Medicare multiplier", "Commercial ≈ Medicare × this", 0.05)}
          <div className="pt-2 border-t border-slate-100" />
          {field("umYTD", "UHealth / UM — YTD wRVU", "Reported institution total")}
          {field("jhsYTD", "Jackson / JHS — YTD wRVU", "Reported institution total")}
        </div>
        <div className="mt-6 rounded-xl bg-slate-50 p-3 text-[11px] text-slate-500 leading-relaxed"><strong className="text-slate-700">Your data only:</strong> set your reported institution YTD wRVUs above, then add your monthly reported baseline in the Timeline tab. Everything here is private to your account.</div>
        <button onClick={() => { onSave(s); onClose(); }} className="mt-6 w-full py-2.5 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800">Save settings</button>
      </div>
    </div>
  );
}
