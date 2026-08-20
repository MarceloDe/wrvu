"use client";
// N33 — first run.
//
// Until this existed, a new user landed on the Tracker showing five zeroes, three
// institutions that were hardcoded fallbacks rather than theirs, and a compensation figure
// derived from a rate they had never entered. This is the screen that asks.
//
// D35 IS THE WHOLE DESIGN: skippable at every step, every field has a working default,
// nothing is a wall. Every step below can be left untouched and the app still works — the
// only thing skipping costs you is that the app knows less, and says so rather than
// guessing. There is no "required" anywhere in this file except a name on an institution
// you have chosen to create, and even that step can be skipped whole.
//
// The look is deliberate. The landing page and sign-in are dark brushed metal
// (.metal-bg / .metal-card / .metal-btn in app/globals.css); the app shell is light slate.
// Nothing bridged them — you signed in on a dark page and were dropped into a white
// dashboard. Onboarding is that bridge: it opens in the metal you just came from and hands
// off to the app at the end.
import React, { useMemo, useState } from "react";
import {
  Brain, Building2, MapPin, Stethoscope, DollarSign, Check, ArrowRight, ArrowLeft,
  Plus, X, Sparkles, ShieldAlert,
} from "lucide-react";
import { US_STATES } from "./states.js";
import { hasRate } from "@/lib/analytics/format.js";

const SPECIALTIES = [
  ["neuro", "Neuroradiology", "Head, neck and spine first in search and quick-add."],
  ["body", "Body / abdominal", "Abdominal and pelvic CT-MR families first."],
  ["both", "Both", "Neuro and body together, ahead of everything else."],
  ["all", "All codes", "No ordering preference. Every code weighted the same."],
];

const STEPS = ["Welcome", "Patient privacy", "Your institution", "Where you read", "Specialty", "Pay", "Ready"];

// "Jackson Memorial Hospital" -> "JMH", "University of Miami" -> "UM", "Baptist" -> "BAPT".
// A blind slice(0,6) produced "JACKSO" and "UNIVER" in the column headers, which is how it
// first shipped and how the GUI walk caught it. Joining words is what a person would do.
const STOPWORDS = new Set(["of", "the", "and", "at", "for", "de", "del"]);
export function shortLabelFor(name) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  const significant = words.filter((w) => !STOPWORDS.has(w.toLowerCase()));
  if (significant.length > 1) return significant.map((w) => w[0]).join("").toUpperCase().slice(0, 5);
  return significant[0].slice(0, 5).toUpperCase();
}

/** A blank institution row in the shape PUT /api/institutions takes. */
const newInstitution = (name = "", extra = {}) => ({
  name: name || "", label: name || "", shortLabel: shortLabelFor(name),
  color: "#0d9488", ytdWrvu: 0, isDefault: false, isPrimary: false,
  practiceState: null, address: null, ...extra,
});

export default function Onboarding({ existingSites = [], onFinish, onDismiss }) {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [skipped, setSkipped] = useState([]);

  // Step 2 — the principal institution.
  const [primary, setPrimary] = useState({ name: "", state: "", address: "" });
  // Step 3 — anywhere else they read, plus the raw site strings that map to each.
  const [others, setOthers] = useState([]);
  const [sites, setSites] = useState(() => existingSites.map((s) => ({ pattern: s, to: "" })));
  // Which freshly-added row should take focus. Adding a row used to leave focus on the
  // "Add" button, so the next thing typed went nowhere — and any space in it pressed the
  // button again, silently adding more empty rows. Keyboard users hit this every time.
  const [focusOther, setFocusOther] = useState(-1);
  const [focusSite, setFocusSite] = useState(-1);
  // Steps 4-5.
  const [specialty, setSpecialty] = useState("all");
  // ISO timestamp when the physician acknowledged the privacy instruction, or null if
  // they skipped it. A date rather than a bool: the question Beta App Review asks is
  // "were users told", and a date answers it (G4.5).
  const [privacyAcknowledgedAt, setPrivacyAcknowledgedAt] = useState(null);
  // Empty, not "78". A value pre-filled into a field the user never looked at is
  // indistinguishable from an answer once it is saved — which is exactly how
  // "$0 @ $78/wRVU" reached a new user's screen. They type it, or it stays unset.
  const [rate, setRate] = useState("");
  const [benchmark, setBenchmark] = useState("578");
  const [cfte, setCfte] = useState("1");

  const named = primary.name.trim();
  const places = useMemo(
    () => [named, ...others.map((o) => o.trim()).filter(Boolean)].filter(Boolean),
    [named, others],
  );

  const markSkipped = (k) => setSkipped((prev) => (prev.includes(k) ? prev : [...prev, k]));
  const back = () => setStep((n) => Math.max(0, n - 1));
  // Rows the user added and left empty are not answers. Prune them on the way out so the
  // summary and the PUT reflect what they actually said.
  const pruneBlanks = () => {
    setOthers((rows) => rows.filter((r) => r.trim()));
    setSites((rows) => rows.filter((r) => r.pattern.trim()));
  };
  const next = () => setStep((n) => Math.min(STEPS.length - 1, n + 1));
  const skip = (k) => { markSkipped(k); next(); };

  /** Everything the wizard collected, in the shapes the two endpoints already take. */
  function collect() {
    const institutions = [];
    if (named) {
      institutions.push(newInstitution(named, {
        label: named, shortLabel: shortLabelFor(named),
        isPrimary: true,
        // The principal institution is also where unmapped sites land. For someone with one
        // workplace that is simply correct, and it avoids inventing an "Other" bucket they
        // never asked for. INV-SITE-NEVER-FAILS needs exactly one default and this is it.
        isDefault: true,
        practiceState: primary.state || null,
        address: primary.address.trim() || null,
      }));
    }
    for (const o of others.map((x) => x.trim()).filter(Boolean)) {
      institutions.push(newInstitution(o, { color: "#0ea5e9" }));
    }
    // No institution named at all: fall back to the built-in set so the classifier still
    // has somewhere to put things, exactly as it does for an account that never opens this.
    if (!institutions.length) return { institutions: null, siteOverrides: {}, settings: null };

    const siteOverrides = {};
    for (const { pattern, to } of sites) {
      const p = pattern.trim().toUpperCase();
      if (p && to && institutions.some((i) => i.name === to)) siteOverrides[p] = to;
    }
    return { institutions, siteOverrides };
  }

  function settingsPatch() {
    const patch = { specialty };
    // An untouched pay step leaves the rate null and the app hides every dollar figure.
    if (!skipped.includes("pay")) {
      patch.ratePerWrvu = String(rate).trim() === "" ? null : Math.max(0, Number(rate) || 0);
      patch.monthlyBenchmark = Math.max(0, Number(benchmark) || 578);
      patch.cFTE = Math.max(0, Number(cfte) || 1);
    }
    return patch;
  }

  async function finish() {
    setSaving(true); setError(null);
    const problem = await onFinish({ ...collect(), settings: settingsPatch(), skipped, privacyAcknowledgedAt });
    setSaving(false);
    if (problem) { setError(problem); return; }
  }

  const card = "metal-card rounded-2xl p-6 sm:p-8";
  const label = "block text-sm font-medium text-slate-200";
  const hint = "text-[12px] text-slate-400 mt-1";
  const input =
    "w-full mt-2 rounded-xl bg-white/5 border border-slate-500/30 px-3 py-2.5 text-slate-100 " +
    "placeholder:text-slate-500 outline-none focus:border-teal-400/70";

  return (
    <div className="fixed inset-0 z-50 metal-bg overflow-y-auto" role="dialog" aria-modal="true"
         aria-labelledby="onboarding-heading">
      <div className="mx-auto max-w-xl px-5 py-10 sm:py-16">

        {/* Progress — a step count, not a promise that any of it is required. */}
        <div className="flex items-center gap-2 mb-6" aria-hidden="true">
          {STEPS.map((s, i) => (
            <span key={s} className={`h-1 flex-1 rounded-full transition-colors ${
              i <= step ? "bg-teal-400" : "bg-slate-600/40"}`} />
          ))}
        </div>
        <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-4">
          Step {step + 1} of {STEPS.length} — {STEPS[step]}
        </p>

        {step === 0 && (
          <section className={card}>
            <span className="grid place-items-center w-12 h-12 rounded-2xl bg-teal-400/10 border border-teal-300/20 mb-5">
              <Brain className="w-6 h-6 text-teal-300" />
            </span>
            <h1 id="onboarding-heading" className="text-3xl font-bold metal-text tracking-tight">Welcome to RadRVU</h1>
            <p className="mt-4 text-slate-300 leading-relaxed">
              Photograph your worklist and it becomes a priced, dated record of what you read —
              scored against CMS 2026 and against your own reported productivity.
            </p>
            <p className="mt-3 text-slate-400 text-sm leading-relaxed">
              Four short questions set it up. You can skip every one of them and change
              anything later in Settings — the app works either way.
            </p>
            <div className="mt-7 flex items-center gap-3">
              <button onClick={next} className="metal-btn rounded-xl px-5 py-2.5 font-semibold flex items-center gap-2">
                Get started <ArrowRight className="w-4 h-4" />
              </button>
              <button onClick={() => onDismiss(["all"])} className="text-sm text-slate-400 hover:text-slate-200 px-2 py-2">
                Skip setup
              </button>
            </div>
          </section>
        )}

        {step === 1 && (
          <section className={card}>
            <span className="grid place-items-center w-12 h-12 rounded-2xl bg-teal-400/10 border border-teal-300/20 mb-5">
              <ShieldAlert className="w-6 h-6 text-teal-300" />
            </span>
            <h1 id="onboarding-heading" className="text-2xl font-bold metal-text tracking-tight">
              Do not capture patient identifiers
            </h1>
            <p className="mt-4 text-slate-300 leading-relaxed">
              Upload only the procedure, site and date columns of your worklist. Never include
              patient names, medical record numbers, dates of birth or accession numbers.
            </p>
            <p className="mt-3 text-slate-400 text-sm leading-relaxed">
              RadRVU records what you read, not who you read it on. It has no field to store a
              patient identifier in. Before an image is uploaded you are asked to mask the
              name and MRN columns, and those pixels are destroyed on this device first — but
              that is a backstop, not a licence to include them.
            </p>
            <p className="mt-3 text-slate-400 text-sm leading-relaxed">
              Photographing a worklist may also breach your institution&apos;s own media or IT
              policy, separately from any patient-privacy rule. Check before you do.
            </p>
            {/* Same Nav as every other step, so the escape hatch is the one D35 describes
                and onboarding-skip.mjs can see it. Only the label changes: continuing
                here is an acknowledgement, not just navigation. */}
            <Nav
              onBack={back}
              onSkip={() => skip("privacy")}
              onNext={() => { setPrivacyAcknowledgedAt(new Date().toISOString()); next(); }}
              nextLabel="I understand"
            />
          </section>
        )}

        {step === 2 && (
          <section className={card}>
            <span className="grid place-items-center w-12 h-12 rounded-2xl bg-teal-400/10 border border-teal-300/20 mb-5">
              <Building2 className="w-6 h-6 text-teal-300" />
            </span>
            <h1 id="onboarding-heading" className="text-2xl font-bold metal-text tracking-tight">Where do you mostly work?</h1>
            <p className="mt-3 text-slate-400 text-sm">
              Your principal institution. Studies whose site we don&apos;t recognise will be
              counted here, so nothing is ever dropped.
            </p>

            <div className="mt-6 space-y-5">
              <div>
                <label htmlFor="ob-name" className={label}>Institution name</label>
                <input id="ob-name" className={input} value={primary.name} autoFocus
                       placeholder="Jackson Memorial Hospital"
                       onChange={(e) => setPrimary({ ...primary, name: e.target.value })} />
              </div>
              <div>
                <label htmlFor="ob-state" className={label}>State <span className="text-slate-500 font-normal">— optional</span></label>
                <select id="ob-state" className={input} value={primary.state}
                        onChange={(e) => setPrimary({ ...primary, state: e.target.value })}>
                  <option value="">Prefer not to say</option>
                  {US_STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                </select>
                <p className={hint}>
                  Recorded for a future locality-accurate payment estimate. It changes nothing today.
                </p>
              </div>
              <div>
                <label htmlFor="ob-address" className={label}>Address <span className="text-slate-500 font-normal">— optional</span></label>
                <textarea id="ob-address" rows={2} className={input} value={primary.address}
                          placeholder="1611 NW 12th Ave, Miami FL 33136"
                          onChange={(e) => setPrimary({ ...primary, address: e.target.value })} />
              </div>
            </div>

            <Nav onBack={back} onSkip={() => skip("institution")} onNext={next} nextLabel="Continue" />
          </section>
        )}

        {step === 3 && (
          <section className={card}>
            <span className="grid place-items-center w-12 h-12 rounded-2xl bg-teal-400/10 border border-teal-300/20 mb-5">
              <MapPin className="w-6 h-6 text-teal-300" />
            </span>
            <h1 id="onboarding-heading" className="text-2xl font-bold metal-text tracking-tight">Anywhere else?</h1>
            <p className="mt-3 text-slate-400 text-sm">
              Add the other places you read. Then, if your worklist writes them differently —
              &quot;JMH&quot; for Jackson, say — map those spellings so they land in the right column.
            </p>

            <div className="mt-6 space-y-2">
              {named && (
                <div className="flex items-center gap-2 text-sm text-slate-300 rounded-xl bg-white/5 border border-slate-500/20 px-3 py-2">
                  <Check className="w-4 h-4 text-teal-300 shrink-0" />{named}
                  <span className="ml-auto text-[11px] text-slate-500">principal</span>
                </div>
              )}
              {others.map((o, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input aria-label={`Other institution ${i + 1}`} className={`${input} mt-0`} value={o}
                         autoFocus={focusOther === i}
                         placeholder="University of Miami"
                         onChange={(e) => setOthers(others.map((x, n) => (n === i ? e.target.value : x)))} />
                  <button aria-label={`Remove institution ${i + 1}`} onClick={() => setOthers(others.filter((_, n) => n !== i))}
                          className="p-2 rounded-lg text-slate-400 hover:text-rose-300 hover:bg-rose-500/10">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <button onClick={() => { setFocusOther(others.length); setOthers([...others, ""]); }}
                      className="w-full py-2 rounded-xl border border-dashed border-slate-500/40 text-xs text-slate-400 hover:border-teal-400/60 hover:text-teal-300 flex items-center justify-center gap-1.5">
                <Plus className="w-3.5 h-3.5" /> Add another place
              </button>
            </div>

            {places.length > 0 && (
              <div className="mt-7">
                <p className="text-sm font-medium text-slate-200">Site spellings <span className="text-slate-500 font-normal">— optional</span></p>
                <p className={hint}>A mapping you write here beats every built-in pattern.</p>
                <div className="mt-3 space-y-2">
                  {sites.map((row, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input aria-label={`Site spelling ${i + 1}`} className={`${input} mt-0 font-mono uppercase`}
                             autoFocus={focusSite === i}
                             value={row.pattern} placeholder="JMH"
                             onChange={(e) => setSites(sites.map((r, n) => (n === i ? { ...r, pattern: e.target.value } : r)))} />
                      <span className="text-slate-500 shrink-0" aria-hidden="true">→</span>
                      <select aria-label={`Institution for site ${i + 1}`} className={`${input} mt-0 w-40`} value={row.to}
                              onChange={(e) => setSites(sites.map((r, n) => (n === i ? { ...r, to: e.target.value } : r)))}>
                        <option value="">choose…</option>
                        {places.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                      <button aria-label={`Remove site ${i + 1}`} onClick={() => setSites(sites.filter((_, n) => n !== i))}
                              className="p-2 rounded-lg text-slate-400 hover:text-rose-300 hover:bg-rose-500/10">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  <button onClick={() => { setFocusSite(sites.length); setSites([...sites, { pattern: "", to: places[0] ?? "" }]); }}
                          className="w-full py-2 rounded-xl border border-dashed border-slate-500/40 text-xs text-slate-400 hover:border-teal-400/60 hover:text-teal-300 flex items-center justify-center gap-1.5">
                    <Plus className="w-3.5 h-3.5" /> Add a spelling
                  </button>
                </div>
              </div>
            )}

            <Nav onBack={back} onSkip={() => skip("sites")} onNext={() => { pruneBlanks(); next(); }} nextLabel="Continue" />
          </section>
        )}

        {step === 4 && (
          <section className={card}>
            <span className="grid place-items-center w-12 h-12 rounded-2xl bg-teal-400/10 border border-teal-300/20 mb-5">
              <Stethoscope className="w-6 h-6 text-teal-300" />
            </span>
            <h1 id="onboarding-heading" className="text-2xl font-bold metal-text tracking-tight">What do you read?</h1>
            <p className="mt-3 text-slate-400 text-sm">
              {/* No count here on purpose. It said 828, which is the number of distinct
                  HCPCS in the release — but this client searches the professional-component
                  subset, which is 668. A figure in onboarding copy that nobody can check
                  drifts the moment the fee schedule does; "every code" is true either way
                  and is the claim that actually matters (D36). */}
              This only changes the order things appear in. Every code stays searchable
              whichever you pick.
            </p>
            <div className="mt-6 grid gap-2">
              {SPECIALTIES.map(([key, title, body]) => (
                <button key={key} onClick={() => setSpecialty(key)}
                        aria-pressed={specialty === key}
                        className={`text-left rounded-xl border px-4 py-3 transition-colors ${
                          specialty === key
                            ? "border-teal-400/70 bg-teal-400/10"
                            : "border-slate-500/25 bg-white/5 hover:border-slate-400/40"}`}>
                  <span className="flex items-center gap-2 text-slate-100 font-medium">
                    {title}
                    {specialty === key && <Check className="w-4 h-4 text-teal-300" />}
                  </span>
                  <span className="block text-[12px] text-slate-400 mt-0.5">{body}</span>
                </button>
              ))}
            </div>
            <Nav onBack={back} onSkip={() => skip("specialty")} onNext={next} nextLabel="Continue" />
          </section>
        )}

        {step === 5 && (
          <section className={card}>
            <span className="grid place-items-center w-12 h-12 rounded-2xl bg-teal-400/10 border border-teal-300/20 mb-5">
              <DollarSign className="w-6 h-6 text-teal-300" />
            </span>
            <h1 id="onboarding-heading" className="text-2xl font-bold metal-text tracking-tight">What are you paid?</h1>
            <p className="mt-3 text-slate-400 text-sm">
              Used only to turn wRVUs into dollars on your own screen. Skip this and the app
              shows wRVUs and hides every dollar figure — which is better than showing you a
              number built on a guess.
            </p>
            <div className="mt-6 space-y-5">
              <div>
                <label htmlFor="ob-rate" className={label}>$ per wRVU</label>
                <input id="ob-rate" type="number" min="0" inputMode="decimal" className={input}
                       value={rate} onChange={(e) => setRate(e.target.value)} />
                <p className={hint}>FY26 extra-coverage rate is about $78. Leave it blank and dollar figures stay hidden.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ob-bench" className={label}>Monthly target</label>
                  <input id="ob-bench" type="number" min="0" className={input}
                         value={benchmark} onChange={(e) => setBenchmark(e.target.value)} />
                  <p className={hint}>AAARAD 65th ≈ 578</p>
                </div>
                <div>
                  <label htmlFor="ob-cfte" className={label}>Clinical FTE</label>
                  <input id="ob-cfte" type="number" min="0" step="0.01" className={input}
                         value={cfte} onChange={(e) => setCfte(e.target.value)} />
                  <p className={hint}>Scales the target</p>
                </div>
              </div>
              {!hasRate(rate) && (
                <p className="text-[12px] text-amber-300/90">
                  With no rate set, dollar figures stay hidden until you add one in Settings.
                </p>
              )}
            </div>
            <Nav onBack={back} onSkip={() => skip("pay")} onNext={next} nextLabel="Continue" />
          </section>
        )}

        {step === 6 && (
          <section className={card}>
            <span className="grid place-items-center w-12 h-12 rounded-2xl bg-teal-400/10 border border-teal-300/20 mb-5">
              <Sparkles className="w-6 h-6 text-teal-300" />
            </span>
            <h1 id="onboarding-heading" className="text-2xl font-bold metal-text tracking-tight">You&apos;re set up</h1>
            <ul className="mt-5 space-y-2 text-sm">
              <Row ok={!!named} yes={`Principal institution — ${named}`} no="No institution set — studies land in the built-in buckets" />
              <Row ok={others.length > 0} yes={`${others.length} other place${others.length === 1 ? "" : "s"}`} no="One place only" muted />
              <Row ok={Object.keys(collect().siteOverrides ?? {}).length > 0}
                   yes={`${Object.keys(collect().siteOverrides ?? {}).length} site spelling(s) mapped`}
                   no="No site spellings mapped — the built-in patterns still apply" muted />
              <Row ok={specialty !== "all"} yes={`Ranked for ${SPECIALTIES.find((s) => s[0] === specialty)?.[1]}`} no="No specialty ordering" muted />
              <Row ok={!skipped.includes("pay") && hasRate(rate)}
                   yes={`$${Number(rate).toLocaleString()} per wRVU`}
                   no="No rate set — dollar figures stay hidden" />
            </ul>
            <p className="mt-5 text-[12px] text-slate-500">
              All of this lives in Settings. Nothing here is permanent.
            </p>
            {error && (
              <p role="alert" className="mt-4 text-[12px] text-rose-300 bg-rose-500/10 border border-rose-400/30 rounded-xl px-3 py-2">
                {error}
              </p>
            )}
            <div className="mt-7 flex items-center gap-3">
              <button onClick={finish} disabled={saving}
                      className="metal-btn rounded-xl px-5 py-2.5 font-semibold flex items-center gap-2 disabled:opacity-60">
                {saving ? "Saving…" : "Open RadRVU"} <ArrowRight className="w-4 h-4" />
              </button>
              <button onClick={back} className="text-sm text-slate-400 hover:text-slate-200 px-2 py-2">Back</button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function Nav({ onBack, onSkip, onNext, nextLabel }) {
  return (
    <div className="mt-8 flex items-center gap-3">
      <button onClick={onBack} aria-label="Back"
              className="p-2.5 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-white/5">
        <ArrowLeft className="w-4 h-4" />
      </button>
      <button onClick={onNext} className="metal-btn rounded-xl px-5 py-2.5 font-semibold flex items-center gap-2">
        {nextLabel} <ArrowRight className="w-4 h-4" />
      </button>
      {/* Every step has this. It is the point (D35). */}
      <button onClick={onSkip} className="ml-auto text-sm text-slate-400 hover:text-slate-200 px-2 py-2">
        Skip
      </button>
    </div>
  );
}

function Row({ ok, yes, no, muted }) {
  return (
    <li className="flex items-start gap-2">
      <span className={`mt-0.5 shrink-0 ${ok ? "text-teal-300" : muted ? "text-slate-600" : "text-amber-400/80"}`}>
        {ok ? <Check className="w-4 h-4" /> : <span className="block w-4 text-center leading-4">–</span>}
      </span>
      <span className={ok ? "text-slate-200" : "text-slate-400"}>{ok ? yes : no}</span>
    </li>
  );
}
