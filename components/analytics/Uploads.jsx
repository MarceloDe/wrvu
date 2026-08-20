"use client";
// N06c — the Uploads tab: the batches already sent, and deleting one.
//
// Extracted from components/NeuroRVU.jsx. Deleting a batch removes real exams, so both
// failure paths are surfaced rather than swallowed: apiFailure for a server refusal,
// networkFailure for an unreachable one (INV-NO-SWALLOW).
import { useState, useEffect } from "react";
import { fmt } from "@/lib/analytics/format.js";
import { Trash2, Loader2, Calendar, Layers, Info } from "lucide-react";
import { apiFailure, networkFailure } from "./client.jsx";

export function UploadsView({ reloadExams }) {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [examDay, setExamDay] = useState("");
  const [uploadDay, setUploadDay] = useState("");
  const [confirm, setConfirm] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/exams?batches=1");
      if (!r.ok) { setStatus(await apiFailure(r, "Couldn't load your uploads")); return; }
      const j = await r.json();
      setBatches(Array.isArray(j.batches) ? j.batches : []);
      setStatus("");
    } catch { setStatus(networkFailure("Couldn't load your uploads")); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function del(params, label) {
    setBusy(true); setStatus("");
    try {
      const r = await fetch(`/api/exams?${params}`, { method: "DELETE" });
      if (!r.ok) { setStatus(await apiFailure(r, "Delete failed")); return; }
      const j = await r.json();
      setStatus(`Deleted ${j.deleted ?? 0} exam${j.deleted === 1 ? "" : "s"}${label ? ` · ${label}` : ""}.`);
      await load();
      await reloadExams?.();
    } catch { setStatus(networkFailure("Delete failed")); }
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
