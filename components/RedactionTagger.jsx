"use client";
// N00f — the region tagger (D8).
//
// Before the FIRST upload for a given institution, the user drags a box over the
// patient-name column and a box over the MRN column. Those two rectangles are
// stored as a redaction profile (geometry only) and every later screenshot for
// that institution is masked with them before it is encoded for upload.
//
// The image shown here has not left the device and does not leave it from this
// screen: the tagger reads a local data URL and never issues a request.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, ShieldCheck, X } from "lucide-react";
import { decodeImageFile } from "../lib/redact/captureRedaction";

const STEPS = [
  { id: "name", label: "Patient name column", hint: "Drag a box over the column that shows patient names." },
  { id: "mrn", label: "MRN column", hint: "Now drag a box over the column that shows MRNs." },
];

export default function RedactionTagger({
  file,
  institution,
  institutions = null,
  onInstitutionChange = null,
  reasonMessage = "",
  onCancel,
  onSave,
}) {
  const [preview, setPreview] = useState(null); // { dataUrl, aspect }
  const [error, setError] = useState("");
  const [regions, setRegions] = useState([]); // [{id,x,y,w,h}] normalized
  const [drag, setDrag] = useState(null); // { x0, y0, x1, y1 }
  const frameRef = useRef(null);

  const stepIndex = regions.length < STEPS.length ? regions.length : STEPS.length;
  const step = STEPS[Math.min(stepIndex, STEPS.length - 1)];
  const done = regions.length >= STEPS.length;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const decoded = await decodeImageFile(file);
        if (!cancelled) setPreview({ dataUrl: decoded.dataUrl, aspect: decoded.aspect });
      } catch (err) {
        if (!cancelled) setError(err?.message || "That image could not be read on this device.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  const rectOf = (d) => ({
    x: Math.min(d.x0, d.x1),
    y: Math.min(d.y0, d.y1),
    w: Math.abs(d.x1 - d.x0),
    h: Math.abs(d.y1 - d.y0),
  });

  const pointAt = (e) => {
    const box = frameRef.current?.getBoundingClientRect();
    if (!box || !box.width || !box.height) return null;
    return {
      x: Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)),
    };
  };

  function onPointerDown(e) {
    if (done) return;
    const p = pointAt(e);
    if (!p) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  }
  function onPointerMove(e) {
    if (!drag) return;
    const p = pointAt(e);
    if (!p) return;
    setDrag((d) => (d ? { ...d, x1: p.x, y1: p.y } : d));
  }
  function onPointerUp() {
    if (!drag) return;
    const r = rectOf(drag);
    setDrag(null);
    if (r.w < 0.02 || r.h < 0.02) {
      setError("That box is too small to mask a column — drag across the whole column.");
      return;
    }
    setError("");
    setRegions((prev) => [...prev, { id: STEPS[prev.length].id, ...r }]);
  }

  const drawn = useMemo(() => (drag ? [{ id: step.id, ...rectOf(drag) }] : []), [drag, step.id]);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-full overflow-y-auto shadow-xl">
        <div className="flex items-start justify-between gap-3 p-5 border-b border-slate-200">
          <div>
            <div className="font-semibold flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-teal-600" />
              Backstop: mask anything identifying
            </div>
            <p className="text-xs text-slate-500 mt-1">
              {reasonMessage || "Your capture should not contain patient names or MRNs at all. If those columns are present, mark them here — once per institution."} These pixels are
              erased from the image before anything is uploaded. This screenshot has not been uploaded.
            </p>
          </div>
          <button onClick={onCancel} className="p-1.5 rounded-lg hover:bg-slate-100" aria-label="Cancel upload">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          {institutions && onInstitutionChange && (
            <label className="text-xs text-slate-600 flex items-center gap-2">
              Institution
              <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
                {institutions.map((k) => (
                  <button
                    key={k}
                    onClick={() => onInstitutionChange(k)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium ${institution === k ? "bg-white shadow-sm" : "text-slate-500"}`}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </label>
          )}

          <div className="text-sm font-medium text-slate-800">
            Step {Math.min(regions.length + 1, STEPS.length)} of {STEPS.length} — {step.label}
          </div>
          <div className="text-xs text-slate-500">{done ? "Both columns marked. Save to redact and continue." : step.hint}</div>

          {error && <div className="text-xs text-rose-600">{error}</div>}

          {!preview && !error && (
            <div className="h-48 flex items-center justify-center text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          )}

          {preview && (
            <div
              ref={frameRef}
              data-testid="redaction-frame"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              className="relative select-none touch-none rounded-xl overflow-hidden border border-slate-300 cursor-crosshair"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview.dataUrl} alt="Screenshot awaiting redaction" className="block w-full h-auto" draggable={false} />
              {[...regions, ...drawn].map((r, i) => (
                <div
                  key={`${r.id}-${i}`}
                  data-testid={`region-${r.id}`}
                  className="absolute bg-slate-900/85 border-2 border-teal-400"
                  style={{
                    left: `${r.x * 100}%`,
                    top: `${r.y * 100}%`,
                    width: `${r.w * 100}%`,
                    height: `${r.h * 100}%`,
                  }}
                >
                  <span className="absolute -top-0.5 left-0.5 text-[10px] font-semibold text-teal-200 uppercase tracking-wide">
                    {r.id}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between gap-3 pt-1">
            <button
              onClick={() => {
                setRegions([]);
                setError("");
              }}
              className="text-xs text-slate-500 hover:text-slate-800"
              disabled={!regions.length}
            >
              Start over
            </button>
            <div className="flex items-center gap-2">
              <button onClick={onCancel} className="px-3 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-100">
                Cancel upload
              </button>
              {/* The instruction this app now gives is "capture the procedure, site and
                  date columns only — no patient names or MRNs". A capture that follows it
                  has nothing to mark, and without this the upload was permanently
                  disabled: two boxes demanded over columns that do not exist. Following
                  the instruction exactly made the feature unusable.
                  Explicit, never a default, and stored on the profile so the aspect-ratio
                  staleness check re-prompts if the layout changes. */}
              <button
                data-testid="redaction-no-patient-columns"
                disabled={!preview || regions.length > 0}
                onClick={() => onSave([], { aspect: preview.aspect, noPatientColumns: true })}
                title={regions.length ? "Start over to clear the boxes you have drawn" : undefined}
                className="px-3 py-1.5 rounded-lg text-sm font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 disabled:opacity-40"
              >
                No patient columns here
              </button>
              <button
                data-testid="redaction-save"
                disabled={!done || !preview}
                onClick={() => onSave(regions, { aspect: preview.aspect })}
                className="px-3 py-1.5 rounded-lg text-sm font-medium text-white bg-teal-600 disabled:bg-slate-300 hover:bg-teal-700"
              >
                Save & redact
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
