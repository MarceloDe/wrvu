// Public marketing landing page — mobile-first, vertical scroll-snap, brushed-metal.
// Built as a self-contained component so it can later be pushed to a claude.ai/design
// project via /design-sync ("Claude cowork design") and iterated visually.
//
// Presentational only (server-renderable). `isSignedIn` flips the primary CTA
// between "Open the app" and "Sign in". Access is invite-only, so there is no
// public sign-up — instead a "Request access" mail link to the admin.

import {
  Brain, Camera, ScanLine, LineChart, ShieldCheck, Building2, Smartphone,
  Sparkles, ArrowRight, Lock, Activity, Database,
} from "lucide-react";

const FEATURES = [
  { icon: ScanLine, title: "AI screenshot extraction", body: "Drop a daily productivity screenshot — vision AI reads the studies, CPT codes and wRVUs automatically." },
  { icon: Camera, title: "Shoot it from your phone", body: "Installable PWA with direct camera capture — photograph a worklist and OCR it on the spot." },
  { icon: LineChart, title: "Timeline & benchmarks", body: "Every session is stored to your private timeline and reconciled against CMS-2026 benchmarks." },
  { icon: Building2, title: "Multi-site reconciliation", body: "Auto-classifies studies by institution and tracks capture completeness across sites." },
  { icon: Database, title: "Your own wRVU tables", body: "Ships with the CMS-2026 neuro schedule and is built to ingest your group's own fee tables." },
  { icon: ShieldCheck, title: "Private by design", body: "Invite-only access, isolated per-user data, server-side API keys. Your numbers stay yours." },
];

const STEPS = [
  { n: "1", title: "Get invited", body: "An admin approves your email. You receive a secure invitation link." },
  { n: "2", title: "Capture & track", body: "Upload or photograph your worklist. AI extracts and logs your wRVUs." },
  { n: "3", title: "See your trajectory", body: "Watch your productivity build against benchmark, month over month." },
];

export default function Landing({ isSignedIn = false, adminEmail = "" }) {
  return (
    <main className="metal-bg min-h-[100dvh] snap-y overflow-y-auto text-slate-200">
      {/* ---- Top nav ---- */}
      <header className="sticky top-0 z-20 backdrop-blur-md bg-[#0b0f14]/70 border-b border-white/5">
        <div className="mx-auto max-w-5xl px-5 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="grid place-items-center w-8 h-8 rounded-xl metal-card">
              <Brain className="w-4.5 h-4.5 text-teal-300" />
            </span>
            <span className="font-semibold tracking-tight metal-text">NeuroRVU</span>
          </div>
          <a
            href={isSignedIn ? "/app" : "/sign-in"}
            className="metal-btn-ghost rounded-lg px-3 py-1.5 text-sm font-medium flex items-center gap-1.5"
          >
            {isSignedIn ? "Open app" : "Sign in"} <ArrowRight className="w-3.5 h-3.5" />
          </a>
        </div>
      </header>

      {/* ---- Hero ---- */}
      <section className="snap-start min-h-[calc(100dvh-3.5rem)] flex flex-col items-center justify-center text-center px-6 py-16">
        <span className="inline-flex items-center gap-1.5 rounded-full metal-card px-3 py-1 text-xs text-slate-300 mb-6">
          <Sparkles className="w-3.5 h-3.5 text-teal-300" /> CMS 2026 · Neuroradiology
        </span>
        <h1 className="text-4xl sm:text-6xl font-bold tracking-tight metal-text leading-[1.05] max-w-3xl">
          Your wRVUs, captured the moment you read.
        </h1>
        <p className="mt-5 max-w-xl text-base sm:text-lg text-slate-400">
          A mobile-first productivity tracker for neuroradiologists. Photograph a worklist,
          let AI extract the studies, and watch your numbers build against benchmark.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
          <a
            href={isSignedIn ? "/app" : "/sign-in"}
            className="metal-btn w-full sm:w-auto rounded-xl px-6 py-3 font-semibold flex items-center justify-center gap-2"
          >
            {isSignedIn ? "Open the app" : "Sign in"} <ArrowRight className="w-4 h-4" />
          </a>
          <a
            href={adminEmail ? `mailto:${adminEmail}?subject=NeuroRVU%20access%20request` : "/sign-in"}
            className="metal-btn-ghost w-full sm:w-auto rounded-xl px-6 py-3 font-medium flex items-center justify-center gap-2"
          >
            <Lock className="w-4 h-4" /> Request access
          </a>
        </div>
        <p className="mt-4 text-xs text-slate-500 flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5" /> Invite-only — every account is approved by an admin.
        </p>
      </section>

      {/* ---- Features ---- */}
      <section className="snap-start px-5 py-20 mx-auto max-w-5xl">
        <h2 className="text-2xl sm:text-3xl font-bold metal-text text-center">Built for the reading room</h2>
        <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="metal-card rounded-2xl p-5">
              <span className="grid place-items-center w-10 h-10 rounded-xl bg-teal-400/10 border border-teal-300/20 mb-4">
                <f.icon className="w-5 h-5 text-teal-300" />
              </span>
              <h3 className="font-semibold text-slate-100">{f.title}</h3>
              <p className="mt-1.5 text-sm text-slate-400 leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---- How it works ---- */}
      <section className="snap-start px-5 py-20 mx-auto max-w-3xl">
        <h2 className="text-2xl sm:text-3xl font-bold metal-text text-center">Three steps</h2>
        <div className="mt-10 space-y-4">
          {STEPS.map((s) => (
            <div key={s.n} className="metal-card rounded-2xl p-5 flex items-start gap-4">
              <span className="grid place-items-center shrink-0 w-9 h-9 rounded-full metal-btn font-bold">{s.n}</span>
              <div>
                <h3 className="font-semibold text-slate-100">{s.title}</h3>
                <p className="mt-1 text-sm text-slate-400">{s.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---- Install / PWA ---- */}
      <section className="snap-start px-5 py-20 mx-auto max-w-3xl text-center">
        <span className="grid place-items-center w-12 h-12 rounded-2xl metal-card mx-auto mb-5">
          <Smartphone className="w-6 h-6 text-teal-300" />
        </span>
        <h2 className="text-2xl sm:text-3xl font-bold metal-text">Install it like a native app</h2>
        <p className="mt-3 text-slate-400">
          Add NeuroRVU to your home screen for full-screen, offline-capable access and
          one-tap camera capture straight into the OCR.
        </p>
      </section>

      {/* ---- Footer CTA ---- */}
      <footer className="snap-start px-5 pt-16 pb-12 mx-auto max-w-3xl text-center border-t border-white/5">
        <Activity className="w-6 h-6 text-teal-300 mx-auto mb-4" />
        <h2 className="text-xl font-semibold metal-text">Ready when you are.</h2>
        <a
          href={isSignedIn ? "/app" : "/sign-in"}
          className="mt-6 inline-flex metal-btn rounded-xl px-6 py-3 font-semibold items-center gap-2"
        >
          {isSignedIn ? "Open the app" : "Sign in"} <ArrowRight className="w-4 h-4" />
        </a>
        <p className="mt-8 text-xs text-slate-600">© NeuroRVU · For productivity tracking only — not a billing system of record.</p>
      </footer>
    </main>
  );
}
