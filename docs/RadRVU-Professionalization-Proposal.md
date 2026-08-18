# NeuroRVU → RadRVU: Professionalization Plan

*A codegraph-grounded evaluation of the current system and a build proposal for a multi-specialty, PHI-capable, freemium radiology workflow manager — structured to be executed by a multi-agent Graph-Engineering Loop.*

---

## Context

`fella.cc` (repo `wruvs`, Vercel project `project-m6jfw`) is a production Next.js 14 PWA used by neuroradiologists to photograph a RIS worklist, have Claude extract each study, and reconcile tracked wRVU against a monthly institutional baseline. It works and it is in real use, but it is a five-week-old, single-contributor, 22-commit prototype: **one 1,623-line React file**, a hardcoded 62-code neuro CPT table, two hardcoded institutions, no tests, no CI, no migrations, no MFA, and no patient data.

The request is to take that prototype to a professional product across nine axes: all radiology specialties and modalities, a temporal/geographic wRVU database, an encrypted on-device PHI vault, a first-run onboarding wizard, richer screenshot extraction, follow-up scheduling with push, a generative AI canvas tab, HIPAA/Apple-grade privacy with US-licensure gating, and Clerk-driven freemium across iOS and web.

That is a rewrite of the product surface on top of a data platform that does not exist yet. This document defines the target architecture, the goal registry, and the agentic build loop that gets there without a permanently loaded full-repo context.

**Working name:** this plan uses **RadRVU**. Renaming is the user's call and is tracked as an open item.

---

## Part 0 — What exists today (verified against the codebase)

### 0.1 Stack

Next.js 14 App Router · React 18 · plain JavaScript (no TypeScript) · Tailwind 3.4 (empty config, no tokens, no dark mode) · recharts · Clerk `@clerk/nextjs` ^5.7.5 production instance · Neon Postgres via Drizzle · Anthropic Messages API · Vercel Pro. Deployed at `https://fella.cc`; `www` 308-redirects to apex via `next.config.mjs` (commit `c0bf583`, because Clerk's production instance only allows the apex as a request origin).

### 0.2 Current data model (`lib/db/schema.js`)

| Table | Shape | Note |
|---|---|---|
| `users` | Clerk id, email, name, `role` | Mirror of Clerk; app-level role only |
| `user_kv` | `(user_id, key)` → jsonb | Backs `/api/store`. Live keys: `nrv_baseline`, `nrv_settings`, `nrv_explorer` |
| `exams` | id, user_id, batch_id, exam_date, cpt, procedure, site, institution, modality, wrvu, estimated, source, uploaded_at | Source of truth for the tracker |
| `extra_duty_periods` | aggregate per shift: pay_model, counts by modality, `amount` + `rate_snapshot` frozen at save | Deliberately outside `exams` |
| `extra_duty_rates` | one current-value row per user | Historical correctness lives in the snapshots |
| `rvu_tables` / `rvu_codes` | multi-fee-schedule model, `is_system` for CMS | **Modeled correctly, and completely unused by the UI** |

### 0.3 Correctness and extensibility problems

1. **The CPT table is duplicated byte-for-byte** in `components/NeuroRVU.jsx:19-83` and `lib/data/cms2026-neuro.js:6-70`. The lib copy feeds the OCR prompt and the DB seed; the component copy feeds the UI — and `lib/data/cms2026-neuro.js:1-4` carries a comment falsely claiming it is the single source of truth. A CMS 2027 update touching only the lib file would update the prompt and the seed while every displayed and computed wRVU stayed on the old values. This is the highest-value latent correctness bug in the repo.
2. **The reference table is 66 codes, and 24 of them are marked `est: true`** — over a third are the author's estimate rather than a published CMS figure. Honestly labeled in the UI, but it is not a defensible billing reference.
3. **`rvu_tables`/`rvu_codes` and `/api/rvu-tables` already exist, are correctly written, and are read by nobody.** The API even does proper authorize-then-fetch. The multi-fee-schedule backend is a free head start on Goals 1 and 2.
4. **The RVU math is wrong for radiology.** Only `work_rvu` is stored — no PE/MP components, no GPCI, no locality, no facility/non-facility split, and **no modifier 26 / TC handling**, which is what a reading radiologist is actually paid on. Dollar figures come from a flat `ratePerWrvu: 78`. `CF_2026 = 33.40` is seeded into the DB and never used in any calculation. The only geography that exists anywhere is an uncached, unvalidated, per-click LLM web search hardcoded to Florida (`NeuroRVU.jsx:1541`).
5. **Institutions are hardcoded into the analytics *shape*, not just config.** `INSTITUTIONS` (3 keys), four separate `["UM","JHS","Other"]` literals, `settings.umYTD`/`jhsYTD`, and field names `repUM`/`repJHS`/`trkUM`/`trkJHS`. Generalizing to N sites is a data-model change.
6. **Two forked modality vocabularies**: display `["CT","CTA","MRI","MRA","Add-on"]` vs the PPC pay set `{mri,ct,xr,other}`. The neuro schedule contains no XR codes at all and OCR defaults unknown modalities to `"CT"`, so screenshot-seeded PPC bundles systematically under-count XR and over-count CT — i.e. this mis-prices real money.
7. **No browser storage of any kind.** `loadKey`/`saveKey` look like localStorage wrappers but hit `/api/store` → Postgres. No IndexedDB, no offline queue, no optimistic buffer. The service worker skips `/api/*` entirely, so offline renders a shell with zero data — while `Landing.jsx:120` markets "offline-capable access."
8. **`users` is a dead table.** Created by both schema paths, never inserted, selected, updated or deleted. There is no Clerk webhook, so nothing ever syncs. Its `role` column is vestigial — admin resolves from Clerk metadata / `ADMIN_EMAILS`.
9. **Deleting a user deletes nothing.** `deleteUser` removes the Clerk account and never touches Postgres. With no FK from `user_id` to `users`, every exam, extra-duty period, rate row and KV blob persists forever. That is a data-retention problem today and a HIPAA right-to-deletion problem the moment PHI exists.

### 0.4 Ship-blockers (fix before a second clinician uses this)

1. **`SETUP_TOKEN` is a root credential for the entire Clerk tenant.** `/api/setup-clerk` is deliberately public to middleware and gated only by a static shared secret compared with `!==`. Behind it: create an arbitrary verified user with an arbitrary password, **reset any user's password**, clear lockouts, force-verify email, and dump every pending invitation and the full allowlist. That is full account takeover of any user including admins, in three HTTP calls, with no rotation, no expiry, no IP restriction, no rate limit and no audit log. It isn't even documented in `.env.example`.
2. **`/api/claude` is an uncapped LLM relay.** It holds zero prompt logic — `system`, `messages`, `tools` and `maxTokens` all come from the client and are forwarded verbatim. Any signed-in user can issue arbitrary prompts with arbitrary tools (including billed `web_search`) at any token count, with no allowlist, no rate limit, no spend cap and no per-user attribution, against the org's shared Anthropic key.
3. **Screenshots containing patient names and MRNs are POSTed to Anthropic today**, unredacted and uncropped, with no BAA and no zero-retention configuration. See §1.1.
4. **`skipPasswordChecks: true`** in both user-creation paths disables Clerk's breach and strength validation, with only a local 8-character floor.
5. **Raw Postgres error text is returned to the client** in roughly ten routes (`Response.json({error: String(e)})`), leaking column names, constraint names and type details. There is no structured logging, no correlation IDs, and no error monitoring at all.
6. **All client errors are swallowed.** `saveKey`, `reloadExams`, `reloadExtra`, `saveExtraRates`, `delPeriod`, `UploadsView.load` all `catch {}`; `/api/store` and `/api/extra-duty/rates` return **HTTP 200 on database failure**. A failed save is indistinguishable from a successful one.
7. **The extra-duty `amount` is accepted from the client and stored verbatim** — never recomputed against the counts and the server-side rate row. Fine for self-reported personal tracking; disqualifying the moment it touches a compensation process.

### 0.5 Engineering baseline gaps

**Two independent schema definitions** — the Drizzle model in `lib/db/schema.js` and a hand-written `CREATE TABLE IF NOT EXISTS` array inside `app/api/setup/route.js:20-101` — kept in sync by hand. They agree today; nothing enforces tomorrow. `drizzle.config.js` points at `./drizzle`, which **does not exist**: there are no committed migrations, no `_migrations` table, no rollback path, and the `IF NOT EXISTS` guards mean `/api/setup` **cannot apply any change to an existing table** — adding a column requires manual `ALTER TABLE` against production.

**No RLS.** Tenant isolation is twelve hand-written `WHERE user_id =` clauses. They are all correct today (I verified every route, and every `DELETE` is IDOR-safe), but there is no database-level backstop and no test asserting isolation. **No constraints** — `pay_model`, `source` and `role` are unconstrained text, no CHECKs, no `(table_id, cpt)` uniqueness. **No MFA**, no security headers, no rate limiting, no caching (including no Anthropic prompt caching, despite a ~4k-character code reference resent on every OCR call). **No tests, no CI**, and `npm run lint` is non-functional — there is no eslint config and eslint is not a dependency. For an app whose entire value proposition is numerical accuracy, the absence of tests around RVU lookup, fiscal-month resolution and pay arithmetic is the most consequential gap after the duplicated code table.

**`ios/` is an empty, untracked local directory.** No Capacitor, Expo, React Native, or native code anywhere.

### 0.6 What is genuinely good and must survive the rewrite

This is a better prototype than its problem list suggests, and several decisions in it would be wrong to discard:

- **The reported-vs-tracked two-layer model** — never summed, always shown side by side. Conceptually right and hard-won.
- **The extra-duty snapshot pattern** — `amount` + `rate_snapshot` frozen at write time so later rate edits can never re-price history, with extra duty stored as aggregate rows that can never contaminate wRVU target math. The best architectural decision in the codebase.
- **The LLM is not trusted for money.** The local table's wRVU overrides the model's `wrvu_each`; unrecognized codes land at 0 flagged `needsPrice` rather than being guessed into a total. Preserve this inversion exactly.
- **`consolidateBaseline()`** — per-field epsilons, explicit discrepancy tracking, a review panel before anything commits, never silently dropping user data.
- **Error surfacing in the OCR path** — `ocrErrorMessage()` maps HEIC / oversize / 429 / 529 / timeout to specific, actionable guidance.
- **Tenant scoping discipline** — `userId` always from `auth()`, never from input; defense in depth via middleware plus a per-route re-check; SQL injection clean throughout.
- Local-time date math that deliberately avoids UTC drift, and the PWA auto-update loop in `PWARegister.jsx`.

---

## Part 1 — Eight findings that change the plan

These were verified externally and each one moves a design decision. Read this section before the architecture.

### 1.1 PHI is already leaving the device, today

The OCR flow sends full worklist screenshots to `api.anthropic.com`. Those screenshots contain patient names and MRNs. Anthropic *does* offer a HIPAA-ready org with a BAA (Messages API, prompt caching and structured outputs are covered; **Batch API, Files API, Code Execution and Web Fetch are explicitly not covered**), but no BAA is in place.

**Decision:** the primary extraction path becomes **on-device OCR** (Apple Vision `VNRecognizeTextRequest` — free, offline, no network), producing structured text that is **redacted on-device** before any cloud call. The cloud model receives de-identified rows. A BAA-covered Anthropic call remains as an opt-in fallback for layouts on-device OCR can't parse. This single decision serves Goals 3, 5 and 8 simultaneously, and it removes the current exposure.

**It also requires native.** Vision OCR is not available to a PWA.

### 1.2 Clerk's HIPAA BAA is Enterprise-only — so keep Clerk out of PHI scope

Clerk is SOC 2 Type 2 and HIPAA-certified, but a **signed BAA is Enterprise-tier**. Neon's HIPAA BAA is self-serve on the **Scale** plan (currently no surcharge; a 15% surcharge is signposted). Vercel's HIPAA BAA became self-serve on **Pro at ~$350/mo**.

**Decision:** architect so that **Clerk never touches patient data** — it holds physician identity, session, MFA and billing only. Then no Clerk Enterprise contract is needed. This is a load-bearing constraint on every schema and every API: patient identifiers must never appear in Clerk metadata, in a Clerk-visible payload, or in an auth-scoped log line.

### 1.3 Local-only PHI is also the strongest legal position

If the physician is workforce of a covered entity and patient data never leaves their device under vendor control, the vendor has a defensible argument that it is not a business associate at all. The moment PHI syncs to the cloud, RadRVU becomes a business associate and — realistically — needs BAAs with each employing institution, which is severe go-to-market friction.

**Decision:** stage it. **Free tier and Phase 1 = device-only PHI, zero cloud PHI.** Cloud PHI sync is a Phase 3 paid feature, client-side envelope-encrypted, behind Neon Scale + Vercel BAAs, and gated on legal review. Do not build cloud PHI first.

*This is a design position, not legal advice. Counsel sign-off is a blocking gate on the Phase 3 node.*

### 1.4 CPT descriptors are AMA-licensed intellectual property

Distributing CPT codes **and descriptors** in a commercial product requires an AMA distribution license with per-release royalties. CMS RVU files are public, but the descriptor text is not free to redistribute.

**Decision:** split the schema so that **numeric RVU data (public, CMS) and descriptor text (licensed, AMA) live in separate tables**, with descriptors loadable/omittable per deployment. Build against a `descriptor_source` abstraction from day one so the product can ship with numbers only if the license lands late. Budget the license as a real line item.

### 1.5 There is no free real-time national licensure API

FSMB offers the **MED API** and **Physician Data Center** data files with primary-source-verified licensure and discipline data, but they are commercial contracts. FCVS is a portable credentials profile, not a per-state verification API.

**Decision:** define a `LicenseVerifier` port with pluggable providers. Ship day one with **NPPES NPI Registry** (free, public: NPI, taxonomy, practice state) plus a manual attestation + document upload, marked `verification_level: 'self_attested'`. Swap in FSMB when funded to reach `verification_level: 'primary_source'`. Never claim primary-source verification in the UI until the FSMB provider is live.

### 1.6 CMS pricing is quarterly, locality-scoped, and needs the 26 modifier

CMS publishes PPRRVU files quarterly (RVU26A January, RVU26B April, …) with work/PE/MP RVUs, status indicators, and PC/TC indicators; GPCIs and localities ship as separate addenda; the CY2026 conversion factor is $33.4009 and CY2026 GPCIs are being phased in over two years.

Correct payment math is:

```
allowed = ((wRVU × wGPCI) + (peRVU × peGPCI) + (mpRVU × mpGPCI)) × CF
```

evaluated **per locality, per effective date, on the -26 professional component** for a reading radiologist.

**Decision:** the wRVU store is version-effective-dated from the start (Goal 2), keyed on `(code, modifier, version)`, with `gpci` and `localities` as first-class tables. Anything less cannot answer "what was 70553-26 worth in Florida locality 03 on 2024-07-15", which is the whole point of Goal 2.

### 1.7 FDA: stay non-device, and put a guardrail in the model

Non-device CDS requires, among other criteria, **no analysis of medical images or signals**. Extracting text from a screenshot of a worklist UI is not image analysis; interpreting a DICOM viewport is. The 2026 revised guidance relaxed the "multiple recommendations" criterion but not the imaging one.

**Decision:** hard product rule — the app never comments on imaging findings. Enforce it in three places: (a) a refusal clause in the AI system prompt, (b) an input guard that detects and rejects/crops DICOM viewport regions in uploads, (c) a persistent UI disclaimer. Add an eval suite of adversarial "read this scan for me" prompts to the Validator.

**Also flag to the user, non-technical:** photographing an institutional worklist may violate the institution's own IT/media policy regardless of HIPAA. Onboarding should surface this and require acknowledgement.

### 1.8 The cloud database is already a limited data set, not de-identified data

Today's `exams` table stores no patient identifier — but the OCR prompt explicitly requests **second precision** (`"YYYY-MM-DDTHH:mm:ss"`, converting AM/PM), so a row reads "MRI Brain W/WO at UMHC on 2026-06-12 18:21:13". Under HIPAA Safe Harbor, **any date more specific than the year is an identifier**. Combined with the institution field, that is realistically re-identifiable. The current cloud data is a limited data set, not de-identified data — even though it contains no name.

This collides directly with Goal 5, which explicitly wants exam time and report/signed time captured, and with the turnaround-time analytics that make those timestamps valuable.

**Decision — split the timestamp by purpose:**

| Use | Granularity | Where |
|---|---|---|
| Turnaround time, shift patterns, "when do I read fastest" | full second precision | **device only**, computed locally, never synced |
| Own-productivity charts and totals | day | cloud, user-scoped under RLS |
| Peer benchmarking cohorts | month | `analytics` only, k ≥ 11 |

The de-identification library (`N24`) owns this downgrade and is property-tested on it. Without this split, the benchmarking feature quietly becomes the re-identification vector.

---

## Part 2 — Target architecture

### 2.1 Platform shape — native Swift client + web PWA

**Decision taken: a native Swift/SwiftUI iOS app.** It is the strongest position for everything that matters here — Vision OCR, SQLCipher with Keychain and Data Protection, APNs, Face ID, Swift Charts, and the App Store review story for a medical app. It costs a second codebase; §2.1.1 is how that cost is contained.

```
ios/                       Xcode project, Swift 6 / SwiftUI, SPM
  RadRVUKit/               domain: pricing, de-identification, extraction — pure, testable
  RadRVUVault/             SQLCipher vault, Keychain, biometric gate
  RadRVUAPI/               generated client (see 2.1.1)
  RadRVUApp/               SwiftUI surfaces
web/                       the existing Next.js 14 app, migrated to TypeScript, PWA retained
  packages/core/           pricing + de-identification, TypeScript
  packages/db/             Drizzle schema + real migrations
contracts/
  openapi.yaml             THE cross-language contract
  fixtures/                shared golden test vectors
```

Frameworks: **ClerkKit + ClerkKitUI** via SPM (Clerk's native Swift SDK — SwiftUI-first prebuilt views plus observable auth state, satisfying Goal 9's iOS half) · **GRDB.swift + SQLCipher** for the vault · **Vision** (`VNRecognizeTextRequest`) for on-device OCR · **LocalAuthentication** for the app lock · **Swift Charts** for the AI canvas · **UserNotifications** for APNs.

The web PWA remains the desktop and analytics surface and the marketing site. **The web app never holds PHI** — it is the de-identified analytics client. That asymmetry is a feature and should be stated plainly in the UI: patient data lives on your phone, and only on your phone.

#### 2.1.1 Containing the two-codebase cost

Swift and TypeScript cannot share code, so the discipline moves to the contract layer:

1. **`contracts/openapi.yaml` is the single source of truth for every endpoint.** The Swift client and the TypeScript client are both *generated* from it (`swift-openapi-generator`, `openapi-typescript`). CI fails if either generated client is stale. No hand-written request code on either side.
2. **The pricing engine is specified once and implemented twice, against shared golden vectors.** `contracts/fixtures/pricing/*.json` holds several hundred `(code, modifier, locality, date) → expected` cases derived from the CMS Look-up Tool. Both the Swift `RadRVUKit` and the TypeScript `packages/core` implementations must pass the identical fixture set in CI. Two implementations agreeing on a third-party-derived oracle is stronger verification than one shared implementation.
3. **The de-identification rules get the same treatment** — one fixture set, two implementations, both property-tested against Safe Harbor.
4. **Where duplication is not worth it, the server is authoritative.** Benchmarks, curated feed and AI orchestration live server-side and are consumed identically by both clients.

This is a real ongoing tax — roughly a day per sprint of contract maintenance — and it is the honest price of the native decision. It buys a client that can actually do Goals 3, 5, 6 and 8 properly, and an Apple review story that does not hinge on a beta cross-platform runtime.

**Android is out of scope** and would be a third codebase. If Android matters within 18 months, that is the one argument that should reopen this decision.

### 2.2 The PHI boundary — the one rule everything else obeys

> **PHI exists only inside the device vault. Everything that crosses the network is de-identified and joined by an opaque local reference.**

```
┌─ iPhone ────────────────────────────────┐
│ PHI vault (SQLCipher, Keychain key,     │
│ biometric-gated, iOS Data Protection)   │
│   patients: local_id, name, mrn,        │
│             accession, institution_id   │
│   patient_exam_links: local_id ↔ exam_ref│
│                                          │
│   on-device Vision OCR → redactor        │
└───────────────┬──────────────────────────┘
                │  only de-identified rows cross
                ▼
┌─ Cloud (Neon, Vercel) ──────────────────┐
│ exams: exam_ref, cpt, modifier, date,   │
│        locality, institution_id, wrvu…  │
│ NO name, NO MRN, NO accession           │
└──────────────────────────────────────────┘
```

- `exam_ref` is a random opaque id minted on-device. The cloud cannot resolve it to a person; only the vault holds the mapping.
- The vault key is generated on-device, stored in the Keychain with `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`, never backed up, never transmitted. Losing the device loses the vault — that is the correct trade, and onboarding must say so plainly.
- Follow-up push notifications carry **no PHI in the payload** — "1 follow-up due today". Details resolve locally after biometric unlock. This is both HIPAA best practice and what Apple expects of health apps.
- Redaction runs before any network call, and is unit-tested against the HIPAA Safe Harbor 18-identifier list: dates generalized to month where used for benchmarking, ages 90+ bucketed, ZIPs truncated to 3 digits (000 for the low-population set).

### 2.3 Cloud data architecture (Neon Postgres)

Three schemas, hard-separated:

**`reference` — the temporal wRVU platform (Goal 2). This is the crown jewel.**

| Table | Purpose |
|---|---|
| `fee_schedule_versions` | `(id, source, year, quarter, effective_from, effective_to, conversion_factor, published_at, source_url, sha256)` — one row per CMS quarterly release, checksummed and immutable |
| `procedure_codes` | `(code, code_system, short_name_key)` — the numeric spine, no licensed text |
| `procedure_descriptors` | `(code, descriptor_source, short, medium, long)` — **AMA-licensed, separable per §1.4** |
| `code_rvus` | `(version_id, code, modifier, work_rvu, pe_rvu_nonfac, pe_rvu_fac, mp_rvu, status_indicator, pc_tc_indicator, global_days, bilateral, multi_proc)` — modifier is `NULL`/`26`/`TC` |
| `localities` | `(mac, locality_code, state, name, counties[])` |
| `gpci` | `(version_id, locality_code, work_gpci, pe_gpci, mp_gpci)` |
| `code_taxonomy` | `(code, specialty_tags[], modality, body_region, contrast, is_addon)` — drives Goal 1 |
| `payer_schedules` / `payer_rates` | non-Medicare and commercial multipliers, same version-effective shape |
| `provider_rate_schedules` | `(org_id\|user_id, effective_from, effective_to, dollars_per_wrvu, cfte, target_wrvu, model)` — the optional provider-specific values |
| `institutions` / `facilities` / `devices` | searchable registry for onboarding (Goal 4); `devices` carries modality, vendor, model, field strength |

Point-in-time resolution is a single function — `resolveValue(code, modifier, localityCode, asOfDate, scheduleId)` in `packages/core` — and **every** dollar figure in the app must go through it. No component computes money.

**`app` — de-identified operational data**

`exams` (gains `exam_ref`, `modifier`, `locality_code`, `facility_id`, `device_id`, `specialty`, `reported_at`, `signed_at`, `version_id` used at pricing time), `batches`, `extra_duty_*` (kept as-is, they are correct), `worklist_layout_profiles` (§2.6), `follow_ups`, `push_subscriptions`, `user_profiles` (specialty, state, locality, institutions, license status, onboarding state), `subscriptions_cache`.

**`analytics` — peer benchmarking, k-anonymous by construction**

Nightly job materializes `benchmark_cells (cohort_key, metric, n, p25, p50, p75, p90)` where `cohort_key` is (specialty × modality × locality-tier × period). **Rows with `n < 11` are suppressed at write time, not at read time** — the API physically cannot serve a small cell. This is the difference between a benchmarking feature and a re-identification vector.

**Enforcement:** Postgres RLS with `FORCE ROW LEVEL SECURITY` on every `app` table, tenant from the Clerk subject, and a production connection role that has neither `BYPASSRLS` nor ownership. Neon branches give the Validator a real, disposable database per verification run.

### 2.4 Device data architecture (GRDB + SQLCipher)

Two databases, deliberately separated so that losing the second costs nothing:

- **`vault.sqlite` (SQLCipher-encrypted)** — patients, MRNs, accessions, follow-up notes, attachments, and any chat turn referencing a patient. Also the full second-precision timestamps from §1.8.
- **`cache.sqlite` (unencrypted)** — de-identified exam mirror, the resolved RVU slice for the user's specialty and locality so pricing works offline, curated news, benchmark cells. Safe to lose, safe to rebuild.

Key handling, which is where these implementations usually go wrong:

1. Generate a 32-byte key with `SecRandomCopyBytes` on first launch — never derived from a password, never hardcoded.
2. Store it in the Keychain with `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` plus the no-backup/no-migration flags, so it never reaches iCloud, an encrypted backup, or a restored device.
3. Configure GRDB with `db.usePassphrase()`, and keep the passphrase's in-memory lifetime as short as possible.
4. Set the vault file's Data Protection class to `.completeUnlessOpen`, so the file is protected at rest by the device key and passcode independently of SQLCipher.
5. Gate opening the vault on `LAContext` (Face ID / passcode), and re-lock on background after a configurable interval.
6. If the device has no passcode or fails a jailbreak heuristic, refuse to open the vault and say why.

A write-ahead outbox in `cache.sqlite` gives real offline capture — the current app's biggest functional lie — with idempotent replay keyed on `exam_ref`.

### 2.5 AI architecture (Goal 7)

Merge **Exams + Codes → one "Data" tab**. Add **AI**: a canvas that fills with generated visuals, with a Claude-app-style composer pinned to the bottom accepting text, photos and files.

- Server route on Vercel (Node runtime, streaming — no Edge needed), AI SDK v6 through the **Vercel AI Gateway**, or direct Anthropic under BAA for the fallback OCR path.
- **The model never writes SQL and never sees PHI.** It calls a fixed tool set:
  - `query_my_metrics(dimensions, filters, period)` → parameterized, RLS-scoped, user's own rows
  - `query_benchmarks(cohort, metric)` → `analytics` only, k≥11 enforced upstream
  - `resolve_value(code, modifier, locality, as_of)` → the pricing function
  - `render_chart(spec)` → a **validated JSON chart spec**, rendered client-side by **Swift Charts** on iOS and Recharts on web. The model emits data and intent, never code. The spec schema lives in `contracts/` and is validated on both sides.
  - `schedule_follow_up(exam_ref, due_at, note)` → cloud row; the patient name is attached locally, after the fact, by the client
  - `search_curated(query)` → pgvector over the curated news/reference corpus
- Patient context reaches the model as `patient_ref: local_7f3a` placeholders; the client rehydrates display names locally. This is how Goal 7's "keep locally associated with the patient name and ID" is satisfied without a single byte of PHI leaving the phone.
- Guardrails: the §1.7 refusal clause, a DICOM-viewport input detector, and an adversarial eval suite in CI.

### 2.6 The onboarding wizard and worklist layout profiles (Goals 4 + 5)

The wizard: **licensure check → specialty → state → locality (derived, confirmable) → institution (searchable registry, "add new" allowed) → facilities → devices/scanners → pay model ($/wRVU, cFTE, target, extra-duty rates) → institutional-policy acknowledgement → first scan.**

Goal 5's real difficulty is that every RIS/PACS worklist looks different. The answer is a **worklist layout profile**: on the first scan for an institution, on-device OCR returns text with bounding boxes and the user **taps each column to tag it** — Patient, MRN, Accession, Procedure, Exam Date, Reported At, Signed At, Site, Device. That mapping is saved as a per-`(user, institution)` profile (geometry + header tokens + regex hints, **no PHI**), and every subsequent scan auto-maps with no LLM call at all. Confidence below threshold re-prompts for confirmation on that field only.

This is what turns Goal 5 from "ask the model harder" into a deterministic, offline, free, private extraction pipeline — and it is why the tagging step belongs in onboarding exactly as the request describes.

### 2.7 Background jobs (Vercel Cron + Queues)

| Job | Cadence | Does |
|---|---|---|
| `ingest-cms-pfs` | quarterly + weekly poll | Fetch PPRRVU/GPCI, checksum, diff against last version, write a new immutable `fee_schedule_version`, alert on unexpected deltas |
| `refresh-benchmarks` | nightly | Recompute `benchmark_cells` with k≥11 suppression |
| `curate-radiology-feed` | daily | Pull vetted sources, summarize, embed into pgvector for `search_curated` |
| `followup-dispatch` | every 15 min | Find due follow-ups, send content-free push |
| `license-reverify` | monthly | Re-check licensure, downgrade entitlements on expiry |
| `usage-rollup` | nightly | Metering for the subscription tier |

### 2.8 Auth, licensure, entitlements

Clerk carries session, **MFA (enable TOTP + backup codes — currently absent entirely)**, and **Clerk Billing** for B2C plans/features with `has()`-based gating (supported in both the Next.js and iOS SDKs, ~0.7% plus Stripe fees, one vendor for auth and billing). Free = local tracking, on-device OCR, local vault, basic charts. Paid = cloud sync/backup, AI tab, peer benchmarks, follow-up push, curated feed. **Entitlements are enforced server-side on every route**, never trusted from the client.

Licensure runs through the `LicenseVerifier` port from §1.5, storing `verification_level`, evidence, and expiry.

---

## Part 3 — The goal registry (`/goals`)

The machine-readable contract that the loop cannot drift from. `goals/GOALS.yaml`:

| ID | Goal | Done when |
|---|---|---|
| **G1** | All radiology specialties and modalities | Code catalog is DB-driven and specialty-tagged; a Body/MSK/Chest/NM/Breast/IR user completes capture→price→analyze with zero neuro-specific strings; no hardcoded `CODES` remains in any component |
| **G2** | Temporal + geographic wRVU platform | `resolveValue()` returns the correct allowed amount for any (code, modifier, locality, date ≥2020) verified against the CMS PFS Look-up Tool; quarterly ingest is automated and checksummed; provider-specific rates are effective-dated |
| **G3** | Encrypted on-device PHI vault | Vault is SQLCipher-encrypted, Keychain-keyed, biometric-gated; a filesystem dump of an unlocked device shows no plaintext identifier; zero PHI columns exist in any cloud table (schema assertion in CI) |
| **G4** | First-run onboarding | A new user reaches a working daily-use home screen configured to their specialty, state, locality, institution, facilities, devices and pay model, with licensure state recorded |
| **G5** | Screenshot extraction of all variables | On-device OCR + layout profile extracts patient, MRN, accession, procedure, exam date, report time, site, device; second scan of the same institution needs no re-tagging; extraction works in airplane mode |
| **G6** | Follow-up scheduling + push | User schedules "+2 weeks: verify progression" on an exam/patient; a content-free push arrives at the due time; detail resolves locally after biometric unlock |
| **G7** | Merged Data tab + AI canvas tab | Exams and Codes are one tab; AI tab accepts text/image/file, renders validated chart specs on canvas, answers own-numbers and peer-comparison questions, and refuses clinical interpretation |
| **G8** | HIPAA/PHI posture + Apple-ready + US-licensure gate | App lock, no PHI in logs/crash reports/notifications, de-identification unit-tested to Safe Harbor, licensure gate enforced, non-clinical disclaimer persistent, App Store privacy manifest complete |
| **G9** | Clerk-driven freemium, iOS + web | MFA on; free/paid plans with server-enforced entitlements; auth and subscription state consistent across the native iOS app and the PWA |
| **G10** | Engineering baseline + ship-blockers closed | `SETUP_TOKEN` root credential removed, LLM proxy locked to server-owned prompts with caps, RLS enforced, errors surfaced not swallowed, account deletion actually deletes; TypeScript, real migrations, CI with tests, security headers |
| **G11** | Curated market data + background jobs | All six jobs run on schedule with observability; the AI tab can cite the curated corpus |
| **G12** | Migration of existing production users | Every current `exams`/`user_kv`/`extra_duty` row survives with correct attribution; no user loses history |

G10 and G12 are additions — they are not in the request but the other ten cannot be verified or shipped without them.

---

## Part 4 — The Graph-Engineering Loop (GEL)

The request: a multi-agent workflow that never needs full-repo context and never drifts from `/goals`, with runtime (not mocked) verification and a validation agent per delivery.

### 4.1 Layout

```
goals/
  GOALS.yaml            G1–G12, acceptance criteria, invariants
  INVARIANTS.yaml       rules no node may violate (§4.5)
  nodes/<node-id>.yaml  one work unit each
  state.json            DAG status, owned by the orchestrator
  evidence/<node-id>/   validator artifacts — the audit trail
```

### 4.2 Node schema

```yaml
id: N14-pricing-engine
title: Point-in-time RVU resolution
goal_refs: [G2]
depends_on: [N11-reference-schema, N12-cms-ingest]
context_query: >                     # the ONLY context the builder loads
  codegraph explore "resolveValue pricing conversion factor gpci locality code_rvus"
contracts:
  - web/packages/core/src/pricing/resolveValue.ts exports
    resolveValue(input: ResolveInput): Promise<ResolveResult>
  - ios/RadRVUKit/Pricing/Resolver.swift exports
    func resolveValue(_ input: ResolveInput) async throws -> ResolveResult
  - both throw/raise PricingUnavailable when no version covers asOf
invariants: [INV-MONEY-ONE-PATH, INV-PARITY, INV-NO-PHI-IN-CLOUD]
verify:
  runtime:
    - pnpm --filter @rad/db migrate:test              # real Neon branch
    - pnpm --filter @rad/core test:pricing            # TS impl vs golden fixtures
    - xcodebuild test -scheme RadRVUKit -only-testing:PricingTests   # Swift impl, same fixtures
    - node scripts/verify/cms-crosscheck.mjs --n 50   # fixtures vs CMS PFS Look-up Tool
  evidence: [cms-crosscheck.json, parity-report.json, coverage-pricing.txt]
done_when:
  - 50/50 sampled (code, modifier, locality, date) match CMS to the cent
  - Swift and TypeScript agree on all 400 golden vectors
  - grep finds zero remaining local wRVU multiplication outside the pricing modules
```

### 4.3 Agent roles

- **Orchestrator** — reads `state.json`, picks ready nodes, dispatches. Holds no code context.
- **Contractor** — turns a goal slice into node YAML with contracts and a runnable `verify` block *before* any code exists. Fails a node that has no runtime verification.
- **Builder** — loads context via `context_query` only (codegraph, not the repo), implements to the contract, runs `verify` itself, and stops.
- **Validator** — **a fresh agent per delivered node, with no memory of how it was built.** Re-runs `verify` from a clean checkout against real infrastructure, inspects evidence, and independently re-derives the `done_when` claims. Returns `PASS` + evidence paths, or `FAIL` + the exact failing command and output. A Builder's self-report is never sufficient.
- **Drift auditor** — periodically diffs the repo against `GOALS.yaml` and `INVARIANTS.yaml`, opens remediation nodes for violations, and flags scope that no goal claims.

Implementation note: this maps onto the `Workflow` tool — `pipeline()` over ready nodes with build and validate as stages, so node B validates while node C is still building. Use `isolation: 'worktree'` for builders that touch overlapping files.

### 4.4 Runtime verification rules (no mocks)

1. **Database verification runs against a real Neon branch**, created and destroyed per run. No sqlite substitute, no in-memory Postgres.
2. **API verification is real HTTP** against a real preview deployment with a real Clerk session, asserting status, body and, where relevant, the SQL side effect.
3. **iOS verification runs on a real simulator or device** via XCUITest under `xcodebuild test`, ending in a screenshot attachment committed to `evidence/`. Vault verification additionally dumps the app container and greps it.
4. **AI verification is an eval suite**, not a snapshot: a fixed question set with graded assertions, plus the adversarial clinical-refusal set.
5. **Compliance verification is executable.** `INV-NO-PHI-IN-CLOUD` is a CI script that introspects the live schema and fails on any column matching the PHI name/pattern list. `INV-NO-PHI-IN-LOGS` greps a captured log stream. De-identification is property-tested against Safe Harbor.
6. **Third-party integration is proven live** at least once per node: a real APNs delivery, a real Stripe test-mode subscription, a real NPPES lookup.
7. Mocks are permitted **only** in unit tests of pure functions, and never as the evidence a `done_when` rests on.

### 4.5 Invariants (`INVARIANTS.yaml`)

| ID | Rule | Machine check |
|---|---|---|
| `INV-NO-PHI-IN-CLOUD` | No patient identifier in any cloud table, log, notification payload, or LLM prompt | Schema introspection + log scan + prompt-builder unit tests |
| `INV-CLERK-PHI-FREE` | No PHI in Clerk metadata or any Clerk-bound payload | Static analysis of Clerk call sites |
| `INV-MONEY-ONE-PATH` | Every dollar figure comes from `resolveValue()` | AST rule: no `* rate` / `* CF` outside `packages/core/pricing` |
| `INV-KANON` | No benchmark cell with n < 11 is ever written or served | DB constraint + API contract test |
| `INV-NO-CLINICAL` | No clinical interpretation output | Adversarial eval suite |
| `INV-NO-SWALLOW` | No empty `catch {}`; no HTTP 200 on a failed write | ESLint rule + route contract tests |
| `INV-TENANT` | Every `app` query is RLS-scoped | Cross-tenant probe test per route |
| `INV-SERVER-PROMPTS` | No client-supplied `system`/`tools`; `maxTokens` capped | Route contract test on the LLM proxy |
| `INV-NO-RAW-ERRORS` | No driver/DB error text in any response body | Fault-injection test per route |
| `INV-DELETABLE` | Account deletion removes every row for that subject | Create → delete → assert-zero-rows test |
| `INV-CONTRACT-SYNC` | Swift and TypeScript clients are generated from current `openapi.yaml` | Regenerate in CI, fail on diff |
| `INV-PARITY` | Swift and TypeScript pricing/de-identification agree | Both run the same golden fixtures |

### 4.6 Why this stays in-context

A Builder's working set is one node YAML (~40 lines) + one codegraph query result (~2–5k tokens) + the invariant list. It never loads the repo. Goal fidelity is maintained by the Contractor writing acceptance criteria *before* implementation and the Validator re-deriving them *after*, independently — not by any agent remembering the whole plan.

---

## Part 5 — The work graph

Six phases. Each is a set of nodes; nodes within a phase are largely parallel.

### Phase A — Baseline and ship-blockers (unblocks everything, G10/G12)

**A0 — do these first, in days not weeks.** They are live exposures on a production app, and each is small:
`N00a` **delete `/api/setup-clerk` and `/api/ocr-test`** from the deployed bundle; move that operator tooling to a local CLI run against Clerk/Neon directly, or re-gate it behind an admin *session* plus an audit log — never a static token · `N00b` **lock down `/api/claude`**: server-owned prompts only (a named-template allowlist), no client-supplied `tools`, a `maxTokens` cap, per-user rate limit and spend cap · `N00c` generic error responses with a correlation id, real server-side logging and error monitoring · `N00d` enable **Clerk MFA** and drop `skipPasswordChecks`.

**A1 — engineering baseline:**
`N01` monorepo + TypeScript migration · `N02` real Drizzle migrations as the single schema source, retiring the DDL-over-HTTP endpoint · `N03` CI: typecheck, a working ESLint with `INV-NO-SWALLOW`, tests, preview deploys · `N04` **RLS with `FORCE ROW LEVEL SECURITY`** on every tenant table plus a cross-tenant probe test per route · `N05` security headers + CSP · `N06` decompose `NeuroRVU.jsx` into feature modules, deleting the duplicated `CODES` and the dead `users` table · `N07` cascading user deletion (Clerk webhook → Postgres) so account deletion actually deletes · `N08` server-side derivation of extra-duty `amount` · `N09` GEL scaffolding (`goals/`, validator harness, Neon-branch test runner).

### Phase B — Reference platform (G1, G2)

`N11` `reference` schema · `N12` CMS PPRRVU/GPCI/locality ingest with checksums and diffs · `N13` `code_taxonomy` seed across all radiology CPT families (70010–79999 plus IR 36xxx/37xxx, mammo, NM/PET) · `N14` `resolveValue()` cross-checked against the CMS Look-up Tool · `N15` AMA descriptor table behind the licensing switch · `N16` provider rate schedules · `N17` **rip out the hardcoded frontend table** and drive everything from the DB · `N18` generalize institutions to an N-site model, killing `umYTD`/`jhsYTD` and the four `["UM","JHS","Other"]` literals · `N19` unify the two modality vocabularies · `N20` migrate existing production rows (G12).

### Phase C — Native Swift client + vault (G3, G5, part of G9)

`N21` Xcode project, SPM, `ClerkKit`/`ClerkKitUI` auth with MFA · `N22` `contracts/openapi.yaml` + generated Swift and TypeScript clients, with a CI staleness check · `N23` GRDB + SQLCipher vault: Keychain key, Data Protection class, biometric gate, app lock, no-passcode refusal · `N24` Vision `VNRecognizeTextRequest` extraction with bounding boxes · `N25` `RadRVUKit` de-identification, property-tested to Safe Harbor against the shared fixtures · `N26` `RadRVUKit` pricing engine passing the same golden vectors as the TypeScript implementation · `N27` worklist layout profiles + the column-tagging UI · `N28` offline outbox and idempotent sync · `N29` `INV-NO-PHI-IN-CLOUD` CI enforcement.

### Phase D — Onboarding + daily-use surfaces (G4, G7)

`N31` licensure gate (NPPES + attestation) · `N32` institution/facility/device registry + search · `N33` onboarding wizard · `N34` specialty-conditional home screen · `N35` merge Exams+Codes into Data · `N36` design tokens, dark mode, accessibility pass (currently: one `aria-` attribute in 1,623 lines) · `N37` follow-up scheduling UI.

### Phase E — Intelligence (G6, G7, G11)

`N41` push infrastructure (APNs directly via `UserNotifications`, content-free payloads) · `N42` `followup-dispatch` cron · `N43` AI chat route with the fixed tool set · `N44` chart-spec schema + canvas renderer · `N45` benchmark materialization with k-anonymity · `N46` curated feed + pgvector · `N47` clinical-refusal guardrail + adversarial evals.

### Phase F — Commercial + compliance (G8, G9)

`N51` Clerk Billing plans/features + server-side entitlements · `N52` App Store privacy manifest, data-safety disclosures, non-clinical disclaimer · `N53` audit logging · `N54` **legal review gate** — BA analysis, institutional policy, terms · `N55` optional cloud PHI sync with client-side envelope encryption, blocked on `N54` · `N56` FSMB primary-source verification when licensed.

**Dependency spine:** A → B → C → D → E → F, with C startable once A completes, and E's benchmarking dependent on B.

---

## Part 6 — Verification plan (end to end)

The acceptance demo, run against real infrastructure:

1. **Fresh install** on a real iPhone from TestFlight. Sign up → Clerk MFA enrolled → NPPES licensure lookup returns a match → onboarding completes for a **Body imaging** radiologist in **Texas**, institution selected from the registry, two facilities, three scanners, $/wRVU set.
2. **Airplane mode.** Photograph a worklist. On-device OCR extracts rows; the user tags columns once. Patient names and MRNs appear in the app. Kill the app, dump the app container from the filesystem — **grep finds no plaintext name or MRN**.
3. Re-enable network. Sync. Query the cloud DB directly: `exams` rows exist with `exam_ref` and correct CPT/modifier/locality, and **no identifier column exists at all**.
4. Photograph a second worklist from the same institution — **no re-tagging**.
5. Verify pricing: pick five exams, compare `resolveValue` output against the CMS PFS Look-up Tool for that locality and date. Exact match.
6. Schedule "+2 weeks: verify progression" on a patient. Advance the clock (or set a near-term due date). **Push arrives with no PHI in the body.** Tap → Face ID → the patient and note resolve locally.
7. **AI tab**: "how does my MRI volume this quarter compare to other body radiologists in my locality?" → streams an answer, renders a chart on canvas, and the served benchmark cell has n ≥ 11. Then: "read this scan and tell me if there's a lesion" → **refuses**, citing the non-clinical scope.
8. Open the web PWA on desktop with the same account. De-identified analytics match. **No patient data is present or reachable.**
9. Downgrade to free tier → AI tab and benchmarks are refused **by the server**, not just hidden in the UI.
10. CI green: Swift and TypeScript builds, both implementations passing the identical pricing and de-identification fixtures, `INV-*` checks, cross-tenant probes, adversarial evals, XCUITest screenshots in `evidence/`.

---

## Part 7 — Risks, costs, and open items

**Cost floor for the compliant paid tier** (verify current pricing before committing): Vercel Pro + HIPAA BAA add-on ~$350/mo · Neon Scale usage-based (~$0.222/CU-hr, $0.35/GB-mo) with HIPAA currently no-surcharge and a 15% surcharge signposted · Clerk Pro + Billing (~0.7% + Stripe fees) · Anthropic API + HIPAA-ready org · **AMA CPT distribution license (unknown, must quote)** · **FSMB MED API/PDC (unknown, must quote)** · MGMA benchmark licensing if published percentiles are shown.

**Risks worth naming now**

- **There are live exposures on the production app right now.** The `SETUP_TOKEN` Clerk root credential, the uncapped LLM relay, and unredacted PHI-bearing screenshots going to Anthropic without a BAA are not future risks — they exist today, on a deployed app with real users. Phase A0 should start regardless of whether the rest of this proposal is approved.
- **Benchmark cold start.** Peer comparison is the headline paid feature and it needs peers. Until N is large, cohorts will be suppressed by k-anonymity and the feature will look empty. Mitigation: seed with published/licensed benchmarks and label them as such; be explicit in the UI about cohort size.
- **The BA question is the business-model fork.** Local-only PHI keeps RadRVU out of business-associate status. Cloud PHI sync almost certainly puts it in, and then institutional BAAs become a sales prerequisite. `N54` must resolve this before `N55` is built, not after.
- **Institutional policy.** Screenshotting a worklist may be prohibited by the employer independent of HIPAA. Surface and acknowledge in onboarding.
- **Apple review.** Medical apps get scrutiny. The non-clinical framing, the privacy manifest, and the absence of PHI in notifications and analytics are what carry the review.
- **Two codebases will drift.** This is the standing cost of the native decision. The mitigation is structural — generated clients, shared golden fixtures, and the `INV-CONTRACT-SYNC` / `INV-PARITY` checks — but it needs enforcement in CI from day one, not retrofitted. If those checks are ever disabled to unblock a release, the architecture has failed.
- **Swift talent and CI.** The build now needs Swift capability and macOS runners. Budget for both.
- **Clerk's iOS SDK is younger than its web SDK.** Pin the version, and verify the MFA and account-portal flows on-device early rather than assuming web parity.
- **Scope.** Roughly a 7–10 month build for a small team, native adding a couple of months over a cross-platform client. The phases are ordered so that **A0 alone closes the live exposures in days**, and **A + B alone already deliver a materially better product** — multi-specialty, correct money, no PHI, no App Store dependency — before any native work begins.

**Decisions taken** (this round): native Swift/SwiftUI client with the PWA retained · device-only PHI now, cloud sync deferred behind legal review · ship-blockers fixed first as Phase A0 · design around AMA, FSMB and MGMA licensing via swappable adapters rather than buying in now.

**Open items still requiring a decision**

1. Product name and domain strategy after the neuro→all-radiology expansion (this plan uses "RadRVU" as a placeholder).
2. Whether the existing production users migrate in place or onboard fresh.
3. Whether Android matters within 18 months — the one input that would reopen the native-Swift decision.
4. Which specialty ships second after neuro, since that choice drives the `code_taxonomy` seeding order in Phase B.
