# RadRVU — Implementation Plan

*Outcome of the professionalization workshop and the codebase audit of 2026-08-17.
Supersedes `docs/RadRVU-Professionalization-Proposal.md`.*

> ## This plan improves a working MVP. It does not build from scratch.
>
> The proposal was written against the `wruvs` repo alone, whose `ios/` directory is empty.
> That framing was wrong. **Three deployables are already in production**, and every node in
> this plan must leave all three working.

Machine-readable companions: [`goals/DECISIONS.md`](../goals/DECISIONS.md) ·
[`goals/GOALS.yaml`](../goals/GOALS.yaml) · [`goals/INVARIANTS.yaml`](../goals/INVARIANTS.yaml) ·
[`goals/BACKLOG.yaml`](../goals/BACKLOG.yaml)

---

## What is actually running

| Deployable | What it is | State |
|---|---|---|
| **`project-m6jfw`** → `fella.cc` | Next.js 14 PWA + `/api/*`, **Neon** Postgres, Clerk | Production. 1,623-line component, 61 hardcoded neuro codes, `SETUP_TOKEN` still live |
| **`neurorvu-edge-api`** | `/api/v1/reference` (ETag-cached) + `/api/v1/resolve` (consent-gated CPT arbitration) | Production. Holds **no user data**. Clerk JWT via `jose`, hard fragment caps, PHI-shaped rejection, never logs bodies |
| **`neurorvu-ios`** | SwiftUI + SwiftData, 4,848 lines, 13 unit + 3 UI test suites | **TestFlight build 1 VALID**, ASC `6799587290`, internal testers since 2026-08-09 |

**The database is Neon, not Supabase.** Verified against `vercel env ls` on both projects and
`lib/db/index.js` (`@neondatabase/serverless`). Supabase belongs to the unrelated
`personal-vault-infra` project.

### iOS is ahead of the PWA, not behind

Already shipping on device: Vision OCR + parser with golden fixtures · a tested `Redaction`
module · FoundationModels on-device generation with eval tests · Clerk auth on the same
production instance · cloud sync by fingerprint with pull-only recovery · CloudKit backup ·
`PrivacyInfo.xcprivacy` · `NSFileProtectionComplete` · an automated altool→ASC pipeline ·
and a user-defined site→bucket override that **never fails a row**.

### The reference platform already exists — in the app bundle

`rvu26a.jsonl`: **828 distinct HCPCS × 3 modifier grains = 2,164 rows.**

| | |
|---|---|
| Columns | `work_rvu`, `facility_pe_rvu`, `non_facility_pe_rvu`, `malpractice_rvu`, `status_code`, `pctc_indicator`, `global_days`, `diagnostic_imaging_family_indicator`, CF `33.4009`, full `raw_row` provenance |
| Modalities | XR 642 · NM 355 · CT 260 · US 226 · MRI 216 · RADONC 169 · PET 78 · IR 74 |
| Status codes | A 1724 · **C 282 (carrier-priced)** · R 75 · M 24 · I 17 · N 17 · X 15 · B 5 · E 4 · J 1 |
| Localities | **Florida only** — Miami, Fort Lauderdale, Rest of Florida, with GPCI and computed payment estimates |

Three things this proves. **G1 is mostly solved in data** — and XR being the largest family
is exactly the bug the PWA has, since its neuro schedule contains no XR at all and OCR
defaults unknowns to `"CT"`. **D16's status-C lane has 282 real rows** behind it, not a
hypothesis. And **959 rows carry `work_rvu == 0`**, overwhelmingly the TC rows — empirical
proof that the technical component has no work RVU, so `-26` and global work RVU are
identical and the modifier never distorts wRVU tracking.

`~/projects/wrvus` holds the build pipeline: `build_radiology_wrvu_2026.py`, the clean
CSV/JSONL, `radiology_wrvu_2026_postgres.sql`, and a quality report.

### Five copies of reference data

`NeuroRVU.jsx` inline · `lib/data/cms2026-neuro.js` · iOS `cms2026-neuro.json`
("verbatim export of wruvs/...") · edge `api/data/reference.json` · iOS `rvu26a.jsonl`.

**Collapsing these into one is the definitive database redesign.**

---

## The decisions

Full record in [`goals/DECISIONS.md`](../goals/DECISIONS.md). D1–D27 came from the workshop;
D28–D40 from the audit. Where they conflict, **the working MVP wins** — the founder rule.

**Architecture.** One `reference` schema in Neon, loaded from
`radiology_wrvu_2026_postgres.sql`, served by the edge API with ETag, read by both clients;
iOS keeps a bundled seed purely as offline fallback (D28). Both Vercel projects stay, with a
sharpened contract: `project-m6jfw` owns all user data, `neurorvu-edge-api` owns reference
and LLM escalation and holds no user rows at all (D29). Cloud becomes the system of record
for exams; the device is a durable cache with an outbox (D31).

**Pricing.** D12 revised twice and settled: extend `build_radiology_wrvu_2026.py` from three
Florida localities to all ~113, then **ship allowed amount alongside compensation** — the
data and the formula already exist (D12-v3). D14 likewise: the MVP already ships CMS
descriptor text for all 828 codes and the Codes view renders it, so descriptors stay, behind
the `descriptor_source` abstraction (D14-v3).

**Product.** Full iOS redesign with `Theme.swift`'s palette as the only fixed point;
consolidated information cards and the date-selection filter must survive (D32). Tabs become
**Tracker · Timeline · Data · AI · Settings** (D37). UM/JHS generalize to N user-created
institutions with per-institution baseline rows (D34). Onboarding is skippable at every step
with working defaults (D35). Specialty **ranks and defaults, never restricts** — all 828
codes stay reachable to everyone (D36).

**Process.** Every node leaves all three deployables working; coupled functionality lands in
one PR (D33). Feature flags are the escape valve, off in production (D33a). Contract changes
are additive-only and ship server + both clients together (D33b) — because you cannot ship a
server and a TestFlight client atomically, and a user on yesterday's build will call today's
API. No node begins by discarding working code (D38).

---

## The always-shippable rule

This is the constraint that shapes the whole backlog.

```
INV-ALWAYS-SHIPPABLE   every node leaves PWA + edge API + iOS working
INV-ADDITIVE-CONTRACTS no field removed or retyped in one release;
                       server and both clients ship in the SAME PR
```

`pnpm verify:shippable` runs the PWA smoke suite against a preview deploy, the edge API
contract tests, and the iOS build plus XCUITest — **all three green before the Validator
considers any `done_when`.** `N03e` builds that harness and blocks every node after it.

**Coupled PRs.** Where functionality cannot stand alone, the backlog marks `couples:` and
those items land together. The four that matter:

| Node | Why it cannot be split |
|---|---|
| **N12** reference API | The edge API cannot start reading Neon unless the iOS sync client still validates the response shape |
| **N17** PWA reads the API | Removing either copy of the CPT table alone leaves the PWA pricing from a stale source |
| **N18** N-institution model | UM/JHS live in the analytics *shape* — 28 `UM` references, `umYTD`/`jhsYTD` inside the baseline math, a 3-case Swift enum. Splitting ships a broken baseline |
| **N30a–c** navigation | Moving Uploads into Tracker while Exams and Codes are still tabs leaves two homes for the same data |

---

## Phases

**A0 · Live exposures** — ~1 day, contracted in `goals/nodes/`. `SETUP_TOKEN` is 32 days old
and still live: one request to `/api/setup-clerk?action=fix-user` resets any password with
`skip_password_checks:true`. `N00c` now also covers the edge API's own `ANTHROPIC_API_KEY`
and `/api/v1/resolve`; `N00f` narrows to the PWA, since iOS already redacts and never
uploads images.

**A1 · Engineering baseline** — real migrations, CI across all three deployables (`N03e` is
the shippable harness), RLS, security headers, decomposition of the 1,623-line component
preserving `consolidateBaseline()` and `ocrErrorMessage()`, cascading deletion,
server-derived extra-duty amounts.

**B · Definitive reference platform** — consolidation, not construction. Extend localities
(`N10`) → Neon `reference` schema (`N11`) → edge API serves it (`N12`, coupled) → pricing
engine with compensation *and* allowed amount (`N14`) → PWA drops its hardcoded table
(`N17`, coupled) → N-institution model (`N18`, coupled, the largest PR in the plan) → unify
the modality vocabularies (`N19`) → migrate and re-price (`N20`).

**C · iOS** — begins with `N21`, an audit of the shipping app; **the 12–20 week estimate is
withdrawn until it reports**. Then the vault (genuinely new — the app is redact-and-discard
today), OCR hardening starting from the documented artifact list, Safe Harbor extension,
pricing parity, layout profiles, outbox, and the redesign behind a `new_navigation` flag.

**D · Onboarding** — licensure, institution registry, the skippable wizard, specialty
ranking, accessibility (the PWA has **one** `aria-` attribute in 1,623 lines).

**E · Intelligence** — local notifications, the AI route on the edge API (it already holds
the key), validated chart specs, self-benchmarking, the public productivity portfolio, and a
clinical guardrail that must cover the **on-device FoundationModels path** too.

**F · Compliance** — privacy manifest (update, don't create), external TestFlight via Beta
App Review, audit logging, legal review.

---

## Timeline

**Not stateable until `N21` reports.** A0 is ~1 day. A1 + B is roughly **2.5–3.5 months** and
well understood. Phase C was priced at 12–20 weeks as greenfield; a large part of it already
ships, so that number is withdrawn rather than defended.

The earlier 8–13 month total was computed before the iOS app was discovered. Anything I put
in its place now would be a guess dressed as an estimate.

---

## What must survive

Called out in every node that touches it:

- **The reported-vs-tracked two-layer model** — never summed, always side by side.
- **The extra-duty snapshot pattern** — `amount` + `rate_snapshot` frozen at write time.
  The best architectural decision in the codebase.
- **The LLM is not trusted for money** — local table overrides the model; unrecognised codes
  land unpriced, never guessed. `INV-NO-ESTIMATES` formalises exactly this.
- **`consolidateBaseline()`** — per-field epsilons, discrepancy tracking, review before commit.
- **`ocrErrorMessage()`** — HEIC / oversize / 429 / 529 / timeout → actionable guidance.
- **`Institution.overrides`** — "classification never fails a row." `INV-SITE-NEVER-FAILS`
  generalises it.
- **`Theme.swift`** — teal tracked, amber extra duty, indigo benchmarks. The redesign's fixed point.
- **`/api/v1/resolve`'s privacy contract** — hard caps, PHI-shaped rejection, never logs bodies.
- Local-time date math avoiding UTC drift, and the PWA auto-update loop.

---

## Open items

1. **Anthropic BAA** — deferred and conditional (D8). Note there are now **two** projects
   holding an `ANTHROPIC_API_KEY`.
2. **AMA CPT licence** — reopened as a *commercial-only* gate by D14-v3, since the MVP ships
   CMS descriptor text today. Not a blocker for internal use.
3. **MGMA/AMGA licence** — optional (D21b).
4. **Licensure depth** — NPPES + self-attestation. Never claim primary-source until FSMB is live.
5. **Institutional media policy** — surfaced in onboarding, but skippable per D35.
6. **Six uncommitted files** in the iOS OCR pipeline — `N21` must resolve their status.

---

## Getting started

```bash
/goals status
/goals node N00a-remove-token-gated-routes
/ultraplan N21-ios-rebaseline        # the highest-information-value node in the plan
/goals contract A1                   # multi-agent, opt-in
/goals audit                         # drift sweep, multi-agent, opt-in
```
