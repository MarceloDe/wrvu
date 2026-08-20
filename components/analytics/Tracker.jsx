"use client";
// N06a — the Tracker tab: log a session, review what OCR extracted, and the KPIs for
// today / this month / the year.
//
// Extracted from components/NeuroRVU.jsx. Two properties this file must keep:
//   - Every wRVU comes from the price book (usePriceBook -> /api/reference/codes ->
//     the CMS reference schema). Nothing here prices a code itself (INV-MONEY-ONE-PATH).
//   - Extra-duty pay is an AGGREGATE saved to its own table, never rows in `exams`, and
//     `amount` is frozen at save time so editing a rate later cannot re-price a past
//     shift. The arithmetic lives in lib/analytics/extra-duty.js and is under test.
import { useState, useEffect, useMemo, useRef } from "react";
import { fmt, localDay, localMonth, hasRate, comp } from "@/lib/analytics/format.js";
import { classifyInstitution, instMeta, DEFAULT_INSTITUTIONS } from "@/lib/analytics/institutions.js";
import { buildAnalytics } from "@/lib/analytics/tracked.js";
import { bucketCounts } from "@/lib/analytics/extra-duty.js";
import { Camera, Search, Plus, TrendingUp, Sparkles, X, FileImage, Calendar, Target, DollarSign, Zap, Check, Building2, Layers, Info, Loader2, Upload } from "lucide-react";
import { REDACTION_SURFACES, buildRedactedImageBlock, buildRedactionProfile, redactionProfileKey } from "../../lib/redact/captureRedaction";
import { InstitutionCards, Kpi } from "./primitives.jsx";
import { CODES, codeByCpt, usePriceBook, callClaude, apiFailure, networkFailure, textOf, ocrErrorMessage, loadKey, saveKey } from "./client.jsx";
import RedactionTagger from "../RedactionTagger";

export function Tracker({ log, reloadExams, settings, extraRates = { perDiemRate: 0, ppcMri: 0, ppcCt: 0, ppcXr: 0 }, extraPeriods = [], reloadExtra }) {
  const prices = usePriceBook();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [draft, setDraft] = useState(null);
  const [manualDate, setManualDate] = useState(localDay());
  // The configured set, not three literals. A user with four institutions gets four
  // buttons; one who has never opened Settings gets the built-in three.
  const instList = settings.institutions ?? DEFAULT_INSTITUTIONS;
  const instKeys = instList.map((i) => i.key);
  const instBy = Object.fromEntries(instList.map((i) => [i.key, i]));
  const [curInst, setCurInst] = useState(instKeys[0] ?? "UM");
  const fileRef = useRef();
  // N00f/D8 — redaction profile for (this user, curInst). Loaded per institution;
  // `tagger` holds the upload that is BLOCKED until the columns are marked.
  const [redactionProfile, setRedactionProfile] = useState(null);
  const [tagger, setTagger] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await loadKey(redactionProfileKey(REDACTION_SURFACES.WORKLIST, curInst), null);
      if (!cancelled) setRedactionProfile(stored && typeof stored === "object" ? stored : null);
    })();
    return () => { cancelled = true; };
  }, [curInst]);

  // Extra-duty tagging: 'regular' = today's flow (counts toward wRVU target);
  // 'extra' = log a paid shift (per-diem or PPC) into extra_duty_periods instead.
  const [mode, setMode] = useState("regular");
  const [payModel, setPayModel] = useState("per_diem");   // per_diem | ppc
  const [exCounts, setExCounts] = useState({ mri: 0, ct: 0, xr: 0, other: 0 });
  const [exExams, setExExams] = useState(0);              // per-diem exam count
  const [exAmount, setExAmount] = useState("");           // per-diem $ override ('' => rate)
  const [exLabel, setExLabel] = useState("");
  // Seed the editable extra-duty counts from the OCR draft (or empty for manual).
  useEffect(() => {
    if (mode !== "extra") return;
    const c = draft ? bucketCounts(draft.items) : { mri: 0, ct: 0, xr: 0, other: 0 };
    setExCounts(c);
    setExExams(draft ? draft.items.length : (c.mri + c.ct + c.xr + c.other));
  }, [draft, mode]);

  const exTotalCounts = exCounts.mri + exCounts.ct + exCounts.xr + exCounts.other;
  const ppcAmount = exCounts.mri * (Number(extraRates.ppcMri) || 0)
    + exCounts.ct * (Number(extraRates.ppcCt) || 0)
    + exCounts.xr * (Number(extraRates.ppcXr) || 0);
  const perDiemAmount = exAmount === "" ? (Number(extraRates.perDiemRate) || 0) : (Number(exAmount) || 0);
  const exAmountFinal = payModel === "ppc" ? ppcAmount : perDiemAmount;

  // This-month + YTD extra-duty pay for the KPI tile.
  const exStats = useMemo(() => {
    const mo = localMonth(), yr = localDay().slice(0, 4);
    let month = 0, ytd = 0;
    for (const p of extraPeriods) {
      const day = String(p.bundleDate).slice(0, 10), amt = Number(p.amount) || 0;
      if (day.slice(0, 7) === mo) month += amt;
      if (day.slice(0, 4) === yr) ytd += amt;
    }
    return { month: Math.round(month), ytd: Math.round(ytd) };
  }, [extraPeriods]);

  async function commitExtra() {
    setBusy(true);
    try {
      const body = {
        payModel,
        bundleDate: `${manualDate}T00:00:00`,
        examCount: payModel === "ppc" ? exTotalCounts : exExams,
        countMri: exCounts.mri, countCt: exCounts.ct, countXr: exCounts.xr, countOther: exCounts.other,
        amount: exAmountFinal,
        rateSnapshot: { perDiem: Number(extraRates.perDiemRate) || 0, mri: Number(extraRates.ppcMri) || 0, ct: Number(extraRates.ppcCt) || 0, xr: Number(extraRates.ppcXr) || 0 },
        label: exLabel || null,
        batchId: draft?.batchId || null,
        source: draft ? "screenshot" : "manual",
      };
      const r = await fetch("/api/extra-duty", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) { setStatus(await apiFailure(r, "Couldn't save that shift")); return; }
      setDraft(null); setExCounts({ mri: 0, ct: 0, xr: 0, other: 0 }); setExExams(0); setExAmount(""); setExLabel("");
      await reloadExtra?.();
      setStatus(`Logged extra-duty ${payModel === "ppc" ? "pay-per-click" : "per-diem"} shift — $${fmt(exAmountFinal)} on ${manualDate}.`);
    } catch { setStatus(networkFailure("Couldn't save that shift")); }
    finally { setBusy(false); }
  }

  async function handleFiles(e) {
    const files = Array.from(e.target.files || []);
    if (fileRef.current) fileRef.current.value = "";
    if (!files.length) return;
    await extractFromScreenshots(files, redactionProfile);
  }

  // N00f/D8 — the ONLY screenshot upload path. A missing or stale redaction
  // profile for this institution blocks the upload and re-prompts the tagger;
  // it never degrades into sending the original.
  async function extractFromScreenshots(files, profile) {
    setBusy(true); setStatus(`Reading ${files.length} screenshot${files.length > 1 ? "s" : ""}…`);
    try {
      let imgs;
      try {
        imgs = [];
        for (const file of files) imgs.push(await buildRedactedImageBlock(file, profile));
      } catch (err) {
        if (err?.code === "redaction-profile-required") {
          setStatus(err.message);
          setTagger({ files, file: files[0], reasonMessage: err.message });
          return;
        }
        throw err;
      }
      const data = await callClaude("ocr", { attachments: imgs });
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
        // Preview only — the server prices authoritatively on commit. Reading it from
        // the price book keeps the preview and the stored value in agreement instead of
        // showing the user one number and saving another.
        const p = canon ? prices.byCpt[canon.cpt] : null;
        const wrvu = p ? (p.workRvu ?? 0) : (Number(x.wrvu_each) || 0);
        const day = (x.exam_date ? String(x.exam_date) : "").slice(0, 10) || manualDate;
        return {
          uid: ++uidc, cpt: String(x.cpt || "?"),
          desc: x.procedure || (canon ? `${canon.desc} ${canon.con}` : "Unrecognized study"),
          // Reference modality first: it is the only source that knows an X-ray is an
          // X-ray. Never "CT" as a fallback — that is a PAID bucket.
          mod: p?.modality || (canon ? canon.mod : null) || x.modality || "Other",
          wrvu, est: p ? p.workRvu === null : true, inst, site: x.site || "",
          date: day, examDate: x.exam_date || `${day}T00:00:00`, needsPrice: !(wrvu > 0),
        };
      });
      if (!items.length) { setDraft(null); setStatus("No exams detected — the worklist may be cropped or too low-res. Retake a sharper, well-lit shot with the full table in frame, or add manually."); }
      else {
        const unpriced = items.filter(i => i.needsPrice).length;
        const dates = [...new Set(items.map(i => i.date))].sort();
        setDraft({ batchId: `batch_${Date.now()}`, source: "screenshot", items });
        setStatus(`Detected ${items.length} exams across ${dates.length} date${dates.length > 1 ? "s" : ""}.` + (unpriced ? ` ${unpriced} need a code below.` : " Review and save."));
      }
    } catch (err) {
      console.error("[OCR] extraction failed:", { status: err?.status, code: err?.code, detail: err?.detail, message: err?.message });
      setStatus(ocrErrorMessage(err));
    }
    finally { setBusy(false); }
  }

  // Persist the tagged geometry for (this user, this institution) and resume the
  // upload that was blocked. Nothing left the device before this point.
  async function saveRedactionProfile(regions, meta) {
    const pending = tagger;
    try {
      const profile = buildRedactionProfile({
        surface: REDACTION_SURFACES.WORKLIST, institution: curInst, regions, aspect: meta.aspect,
      });
      setRedactionProfile(profile);
      setTagger(null);
      await saveKey(redactionProfileKey(REDACTION_SURFACES.WORKLIST, curInst), profile);
      if (pending?.files?.length) await extractFromScreenshots(pending.files, profile);
    } catch (err) {
      console.error("[redaction] profile save failed:", { code: err?.code, message: err?.message });
      setStatus(ocrErrorMessage(err));
    }
  }

  function addManual(code) {
    setDraft(d => {
      const base = d || { batchId: `batch_${Date.now()}`, source: "manual", items: [] };
      // Preview only. The server re-prices on save and its answer is the one that is
      // stored, so this can never be the figure of record — but it must still agree,
      // and it must not invent one where CMS has none.
      const p = prices.byCpt[code.cpt];
      const item = { uid: Date.now() + Math.random(), cpt: code.cpt, desc: `${code.desc} ${code.con}`, mod: code.mod,
        wrvu: p?.workRvu ?? 0, est: p ? p.workRvu === null : true, inst: curInst, site: "", date: manualDate, examDate: `${manualDate}T00:00:00`, needsPrice: false };
      return { ...base, items: [...base.items, item] };
    });
  }
  function removeDraftItem(it) { setDraft(d => { const items = d.items.filter(i => i.uid !== it.uid); return items.length ? { ...d, items } : null; }); }
  function cycleInst(it) {
    const order = instKeys;
    setDraft(d => ({ ...d, items: d.items.map(i => i.uid === it.uid
      ? { ...i, inst: order[(order.indexOf(i.inst) + 1) % order.length] } : i) }));
  }
  function assignCode(it, code) {
    const p = prices.byCpt[code.cpt];   // preview; the server re-prices on commit
    setDraft(d => ({ ...d, items: d.items.map(i => i.uid === it.uid
      ? { ...i, cpt: code.cpt, desc: `${code.desc} ${code.con}`, mod: code.mod, wrvu: p?.workRvu ?? 0, est: p ? p.workRvu === null : true, needsPrice: false }
      : i) }));
  }
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
      if (!r.ok) { setStatus(await apiFailure(r, "Couldn't save those exams")); return; }
      const left = draft.items.filter(i => i.needsPrice).length;
      setDraft(null);
      await reloadExams();
      setStatus(left ? `Saved. ${left} exam(s) stored at 0 wRVU — assign codes to count their value.` : `Saved ${payload.exams.length} exams to your database.`);
    } catch { setStatus(networkFailure("Couldn't save those exams")); }
    finally { setBusy(false); }
  }

  const a = useMemo(() => buildAnalytics(log, settings), [log, settings]);

  return (
    <div className="space-y-6">
      {tagger && (
        <RedactionTagger
          file={tagger.file}
          institution={curInst}
          reasonMessage={tagger.reasonMessage}
          onCancel={() => { setTagger(null); setStatus("Upload cancelled — nothing was sent."); }}
          onSave={saveRedactionProfile}
        />
      )}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Kpi icon={Calendar} label="Tracked this month" value={fmt(a.thisMonth.actual, 0)} sub={`vs ${fmt(a.thisMonth.bench, 0)} target`} delta={a.thisMonth.variancePct} />
        <Kpi icon={TrendingUp} label="Tracked YTD" value={fmt(a.ytd.actual, 0)} sub={`${fmt(a.ytd.studies, 0)} studies logged`} />
        <Kpi icon={Target} label="Annual projection" value={fmt(a.annual.projected, 0)} sub={`vs ${fmt(a.annual.bench, 0)} target`} delta={a.annual.variancePct} />
        <Kpi icon={DollarSign} label="Tracked comp value"
             value={comp(a.ytd.actual, settings.ratePerWrvu) ?? "—"}
             sub={hasRate(settings.ratePerWrvu) ? `@ $${settings.ratePerWrvu}/wRVU` : "Set your rate in Settings"} accent />
        <Kpi icon={Zap} label="Extra-duty pay" value={`$${fmt(exStats.month, 0)}`} sub={`$${fmt(exStats.ytd, 0)} YTD · this month`} />
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
              {instKeys.map(k => <button key={k} onClick={() => setCurInst(k)} className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${curInst === k ? "bg-white shadow-sm" : "text-slate-500"}`} style={curInst === k ? { color: instBy[k]?.color } : {}}>{instBy[k]?.short ?? k}</button>)}
            </div>
            <label className="text-xs text-slate-500 flex items-center gap-2">Date<input type="date" value={manualDate} onChange={e => setManualDate(e.target.value)} className="border border-slate-200 rounded-md px-2 py-1 text-xs font-mono" /></label>
          </div>
        </div>
        {/* Regular vs extra-duty tagging. Extra duty is paid separately and does NOT count toward the wRVU target. */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5 text-xs font-medium">
            <button onClick={() => setMode("regular")} className={`px-3 py-1.5 rounded-md ${mode === "regular" ? "bg-white shadow-sm text-slate-900" : "text-slate-500"}`}>Regular</button>
            <button onClick={() => setMode("extra")} className={`px-3 py-1.5 rounded-md ${mode === "extra" ? "bg-white shadow-sm text-amber-600" : "text-slate-500"}`}>Extra duty</button>
          </div>
          {mode === "extra" && (
            <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5 text-xs font-medium">
              <button onClick={() => setPayModel("per_diem")} className={`px-3 py-1.5 rounded-md ${payModel === "per_diem" ? "bg-white shadow-sm text-slate-900" : "text-slate-500"}`}>Per diem</button>
              <button onClick={() => setPayModel("ppc")} className={`px-3 py-1.5 rounded-md ${payModel === "ppc" ? "bg-white shadow-sm text-slate-900" : "text-slate-500"}`}>Pay-per-click</button>
            </div>
          )}
          {mode === "extra" && <span className="text-[11px] text-amber-600 flex items-center gap-1"><Info className="w-3.5 h-3.5 shrink-0" />Logged as a paid shift — not counted toward your wRVU target.</span>}
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

        {mode === "regular" && draft && (
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

        {mode === "extra" && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/50 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-medium text-amber-900 flex items-center gap-2"><Zap className="w-4 h-4" />Extra-duty shift · {payModel === "ppc" ? "pay-per-click" : "per diem"} · {manualDate}</div>
              {draft && <div className="text-xs font-mono text-amber-700">{draft.items.length} detected</div>}
            </div>

            {payModel === "per_diem" ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <label className="flex flex-col gap-1 text-[11px] font-medium text-slate-500">Exams in shift
                  <input type="number" min="0" value={exExams} onChange={e => setExExams(Math.max(0, Math.round(Number(e.target.value) || 0)))}
                    className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm font-mono text-slate-900" /></label>
                <label className="flex flex-col gap-1 text-[11px] font-medium text-slate-500">Pay for shift ($)
                  <input type="number" min="0" step="0.01" value={exAmount === "" ? "" : exAmount} placeholder={String(Number(extraRates.perDiemRate) || 0)}
                    onChange={e => setExAmount(e.target.value)}
                    className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm font-mono text-slate-900" /></label>
                <div className="flex flex-col gap-1 text-[11px] font-medium text-slate-500">Earnings
                  <div className="rounded-lg bg-white border border-amber-200 px-2.5 py-1.5 text-sm font-mono font-bold text-amber-700">${fmt(exAmountFinal, 0)}</div>
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { k: "mri", label: "MRI", rate: extraRates.ppcMri },
                    { k: "ct", label: "CT", rate: extraRates.ppcCt },
                    { k: "xr", label: "XR", rate: extraRates.ppcXr },
                    { k: "other", label: "Other", rate: 0 },
                  ].map(({ k, label, rate }) => (
                    <label key={k} className="flex flex-col gap-1 text-[11px] font-medium text-slate-500">{label} <span className="text-slate-400">· ${fmt(Number(rate) || 0, 0)}/ea</span>
                      <input type="number" min="0" value={exCounts[k]} onChange={e => setExCounts(c => ({ ...c, [k]: Math.max(0, Math.round(Number(e.target.value) || 0)) }))}
                        className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm font-mono text-slate-900" /></label>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between text-sm">
                  <span className="text-[11px] text-slate-500">{exTotalCounts} exams{exCounts.other ? ` · ${exCounts.other} "Other" not paid` : ""}</span>
                  <span className="font-mono font-bold text-amber-700">${fmt(exAmountFinal, 0)}</span>
                </div>
              </>
            )}

            <div className="flex flex-wrap gap-2 mt-3 items-center">
              <input value={exLabel} onChange={e => setExLabel(e.target.value)} placeholder="Note (optional)"
                className="flex-1 min-w-[140px] border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm bg-white" />
              <button onClick={commitExtra} disabled={busy || exAmountFinal <= 0} className="px-4 py-1.5 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 disabled:opacity-50 flex items-center gap-1.5"><Check className="w-4 h-4" />Save shift</button>
              {draft && <button onClick={() => setDraft(null)} className="px-3 py-1.5 rounded-lg text-slate-500 text-sm hover:bg-slate-100">Clear photo</button>}
            </div>
            <p className="text-[11px] text-slate-400 mt-2 flex items-start gap-1.5"><Info className="w-3.5 h-3.5 mt-px shrink-0" />
              {payModel === "per_diem"
                ? "Pay defaults to your per-diem rate (Settings) — edit it for this shift if it differs. Uses the Date above."
                : "Counts are auto-filled from the photo and editable; earnings = Σ(count × modality rate). Set rates in Settings."}
            </p>
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

export function CodeAssign({ onPick }) {
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
export function ManualAdd({ onAdd }) {
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
