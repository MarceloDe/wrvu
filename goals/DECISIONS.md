# RadRVU — Decision Record

Outcome of the professionalization workshop, 2026-08-17.

> **This is a brownfield plan. It improves a working MVP; it does not build from scratch.**
> Three deployables are already in production and must stay working through every node:
> `project-m6jfw` (Next.js PWA + `/api/*`, Neon, Clerk) · `neurorvu-edge-api`
> (`/api/v1/reference`, `/api/v1/resolve`) · `neurorvu-ios` (SwiftUI + SwiftData, on
> TestFlight). See D28-D40, added after the codebase audit of 2026-08-17.
>
> **The database is Neon, not Supabase.** Supabase belongs to the unrelated
> `personal-vault-infra` project. Verified: no Supabase env var exists on either Vercel
> project for this product.

This file is **normative**. `GOALS.yaml`, `INVARIANTS.yaml` and every node YAML derive
from it. When a decision changes, change it here first, then propagate — and record the
supersession rather than editing history away.

Supersedes: `docs/RadRVU-Professionalization-Proposal.md` (retained as the analysis that
produced these questions; where the two disagree, this file wins).

---

## D1–D4 · Destination and constraints

| ID | Decision | Consequence |
|---|---|---|
| **D1** | **Small trusted group.** Colleagues at UM/JHS. No public signup, no billing, no App Store listing. | Drops G9's billing half. Softens G8 from App Store review to TestFlight. |
| **D2** | **Solo, ~30h/wk, agent-assisted.** | Review capacity is the scarce resource. Drives D25. |
| **D3** | **Up to ~$500/mo** recurring, pre-revenue. | Affords Vercel Pro + HIPAA BAA, Neon Scale + BAA, Clerk Pro. Does *not* pre-fund AMA/FSMB/MGMA licences. |
| **D4** | **Name: RadRVU. Domain: keep `fella.cc`.** | Branding-only change. No Clerk production-instance domain rebinding. |

## D5–D11 · Platform and PHI boundary

| ID | Decision | Consequence |
|---|---|---|
| **D5** | **Native Swift/SwiftUI now**, as proposed. | Two codebases. `contracts/openapi.yaml` + generated clients + shared golden fixtures become load-bearing from day one. |
| **D6** | **PHI is in scope.** Patient names and MRNs are stored, in an encrypted on-device vault. | G3 is real work, not a formality. Vault + Safe Harbor de-identification are first-class. |
| **D7** | **iPhone only.** Android is out of scope for ≥18 months. | The one input that would have reopened D5 is settled. |
| **D8** | **Redact before upload now; Anthropic BAA deferred and conditional.** Kill the hardcoded `web_search` call. | Closes the live exposure in days for $0. BAA revisited only if the cloud fallback path carries real volume. |
| **D9** | **PWA = de-identified analytics and desktop surface only.** Never holds PHI. | Stated plainly in the UI. Asymmetry is a feature. |
| **D10** | **TestFlight external** (≤10,000 testers). | **Beta App Review applies** — the non-clinical disclaimer, privacy manifest and PHI-free notifications stay in scope. |
| **D11** | **Agents write Swift; the user reviews.** | XCUITest, golden fixtures and `INV-PARITY` are the only real safety net. They may never be skipped to unblock a release. |

## D12–D17 · Reference platform

| ID | Decision | Consequence |
|---|---|---|
| **D12** | **Ship allowed-amount pricing, after extending locality coverage.** The RVU26A dataset already carries work/PE-fac/PE-nonfac/MP at `(hcpcs, modifier)` grain, `status_code`, `pctc_indicator`, `global_days`, CF 33.4009 — *and* computed GPCI + payment estimates, but **for three Florida localities only**. One node extends `~/projects/wrvus/build_radiology_wrvu_2026.py` from 3 localities to all ~113 using the CMS GPCI addendum — same formula, already implemented — and then both compensation and allowed amount ship everywhere. | **Revised 2026-08-17, superseding D12-v2 (and D12-v1).** v2 staged this out on the belief it was unbuilt. It is largely *already built and paid for*. `INV-NO-ALLOWED-AMOUNT` is retired. Compensation and allowed amount are always shown as distinct figures and never summed. |
| **D13** | **CY2026 forward only.** No historical backfill. | Cheap now. Cost: exams under codes deleted or revalued before 2026 cannot be priced at their contemporaneous value. Revisit if D17 re-pricing surfaces gaps. |
| **D14** | **Descriptors stay — the MVP already ships them.** `rvu26a.jsonl` carries `procedure_name` / `cms_description` (`"Ct abdomen w/contrast"`) for all 828 codes, bundled in the TestFlight build today. Keep them, behind the `descriptor_source` abstraction so they remain separable. The in-house labels from `cms2026-neuro.js` remain as the neuro UX-default display layer. | **Revised 2026-08-17, superseding D14-v2 and D14-v1, under the founder rule "keep prior decisions unless they conflict with the working MVP." This one conflicts.** v2 assumed no licensed text was present; it is present and load-bearing for the Codes view across 828 codes. Ripping it out would degrade a working feature to satisfy a licence nobody has demanded for internal use. `INV-NO-LICENSED-TEXT` is replaced by `INV-DESCRIPTOR-SEPARABLE`. The AMA licence returns to the open-items list as a *commercial-only* gate. |
| **D15** | **Second specialty: Body / abdominal imaging.** | Drives `code_taxonomy` seeding order: 74xxx, 72xxx abdominal/pelvic CT-MR families after the neuro set. |
| **D16** | **Hard fail, plus a narrow status-C lane.** Any code absent from the authoritative CMS version resolves to `unpriced`, is surfaced, and is excluded from totals. Status-`C` carrier-priced codes may carry a flagged user override, separately totalled, never mixed into the authoritative sum. | Preserves the existing `needsPrice` inversion. Encoded as `INV-NO-ESTIMATES`. |
| **D17** | **Migrate in place and re-price historical rows** to the authoritative CMS value for the version in effect on the exam date. | Historical totals **will change**. A one-time reconciliation report is required so the user can see exactly what moved and why. |

### Superseded decisions

Recorded rather than edited away, per the rule at the top of this file.

| Superseded | Original text | Why reverted |
|---|---|---|
| **D12-v1** | *Full CMS allowed-amount math now* — `((wRVU×wGPCI)+(peRVU×peGPCI)+(mpRVU×mpGPCI))×CF` per locality, per effective date, on `-26`, shipped in Phase B. | Employed radiologists are compensated on `wRVU × contracted $/wRVU`; GPCI and the conversion factor never touch the paycheck. Allowed amount answers a *revenue* question, not a *compensation* one. For diagnostic radiology the technical component carries zero work RVU, so `-26` and global work RVU are identical — wRVU tracking is not distorted by the modifier at all. Building the GPCI layer up front bought a number nobody needed yet and roughly doubled Phase B. D12-v2 keeps every column and both schema keys, so the layer can be added later with **no migration**. |
| **D14-v1** | *Split schema; load AMA/CMS descriptors anyway*, with the AMA licensing gate kept live as node `N15`. | Superseded twice. See D14-v2 and D14-v3. |
| **D12-v2** | *Staged pricing* — store the full PPRRVU row but ship only `wRVU × contracted rate`; allowed-amount layer later. | Written while the plan believed the reference platform was unbuilt. `rvu26a.jsonl` already contains the PE/MP/status/PC-TC columns **and** computed GPCI and payment estimates for three Florida localities, shipping in TestFlight. Staging out work that is already done and in users' hands is not caution, it is waste. D12-v3 extends locality coverage and ships. |
| **D14-v2** | *Numbers only* — never persist AMA or CMS descriptor text; author all labels in-house. | Correct about `lib/data/cms2026-neuro.js`, wrong about the product. The `rvu26a.jsonl` bundle carries `cms_description` for all 828 codes and the Codes view renders it today. The decision conflicted with the working MVP, and the founder rule resolves that in the MVP's favour. |

### Correction — a native iOS app already exists (discovered 2026-08-17 via Cortex)

The proposal states: *"`ios/` is an empty, untracked local directory. No Capacitor, Expo,
React Native, or native code anywhere."* That is true **of the `wruvs` repo** and **wrong
about the project.** A separate repo — `/Users/mfelix/projects/neurorvu-ios` — holds a real,
shipping native Swift app:

| | |
|---|---|
| Scale | **49 Swift files, 6,243 lines**, XcodeGen (`project.yml`), unit + UI test targets, fixtures |
| Distribution | **TestFlight build 1 VALID with internal testers** since 2026-08-09. ASC app id `6799587290` |
| Already built | Vision OCR + parser pipeline with fixture tests · a `Redaction` module with tests (`Redaction.redact("MRI BRAIN MRN 4521") == "MRI BRAIN [id]"`) · FoundationModels on-device generation with eval tests · Clerk auth against the same production instance · cloud sync to `fella.cc/api/*` · `PrivacyInfo.xcprivacy` · `NSFileProtectionComplete` · backup/restore · an automated altool→ASC upload pipeline |
| Not built | SQLCipher/GRDB vault · Keychain-held encryption key · biometric gate · worklist layout profiles · `openapi.yaml` and generated clients · Swift pricing parity · offline outbox |

**Current iOS architecture is redact-and-discard, not vault-and-retain** — it strips MRN/DOB/SSN
before escalation rather than storing identifiers. So **G3's vault is still genuinely new
work**, but most of the Phase C *scaffolding* is done.

**Consequences:**

- **D5 is validated and much cheaper than priced.** Native Swift was not a 12–20 week
  greenfield bet; it is an existing codebase to extend.
- **D10 is nearly satisfied.** Internal TestFlight is live; external is a smaller step than
  the plan assumed.
- **D11 is proven.** Agents have already written this Swift successfully, through P0–P6 gates.
- **Phase C must be re-baselined before it is contracted.** Node `N21` is replaced by an
  audit node. The 12–20 week estimate is withdrawn pending that audit — it is very likely
  far smaller, but a ten-minute inspection is not a basis for a new number.

There is also a `semantic/neurorvu-ios/vision-ocr-photographed-monitor-failure-modes.md`
note documenting real artifact classes from photographed monitors — glued year+time
(`"7/3/20264:07"`), ellipsis tokens, merged modality+spine (`"CTT Spine"`), site names
merged into the procedure cell, character corruption (`"8:89:17"`), and unrecoverable dates
requiring date-optional rows. **Any G5 work starts from that list, not from scratch.** It
also records that `PhotosPicker` iCloud content is invisible to XCUITest, which dictates the
test architecture for `N24`/`N27`.

**Root cause of the miss:** the Cortex MCP server has been dead since a merge left committed
conflict markers in `tools/cortex/mcp_server.py`, so no agent could read this history. The
workshop planned Phase C blind. Repaired 2026-08-17 (`be097e2`).

### Correction to the source proposal
The proposal states "66 codes, 24 estimated" in one place and "62" in another.
**The actual file is 61 codes with 25 `est:true`** — 41% estimated. Additionally,
`70472`/`70473` ("CT Cerebral Perfusion") and `76390` ("MR Spectroscopy") are suspected
**wrong or deleted code numbers**, not merely imprecise values, and `76376` may carry a
national work RVU of `0.00` against the table's estimate of `0.20`. `N12` ingest must
surface all three as loud failures.

## D18–D20 · Engineering baseline

| ID | Decision | Consequence |
|---|---|---|
| **D18** | **All of Phase A0 first, including credential rotation.** | ~1 working day. Nothing else starts until it ships. Rotation is non-negotiable because no audit log can prove the old `SETUP_TOKEN` was never used. |
| **D19** | **Full monorepo + TypeScript migration up front.** | `N01` is the first A1 node. Painful, but every later node lands in the right place and Swift/TS contract discipline works from day one. |
| **D20** | **Full verification rigor. No mocks outside pure-function unit tests.** | Real Neon branch per run, real HTTP against a preview deploy with a real Clerk session, XCUITest on a real simulator with screenshot evidence. This is the safety net that D11 makes essential. |

## D21–D23 · Product surface

| ID | Decision | Consequence |
|---|---|---|
| **D21** | **Self-benchmarking + a public declared-productivity portfolio.** No peer/cohort benchmarking. | **`analytics` schema, the nightly materialization job and all k-anonymity machinery are deleted from the plan** — at ~10 users no cohort cell could ever reach n≥11, so the feature was correct and permanently empty. Replaced by `INV-NO-PEER-DATA`: no user's data is ever served to another user. |
| **D21a** | **No LinkedIn scraper.** | LinkedIn has no public jobs API; their ToS bar scraping independently of *hiQ v. LinkedIn*'s CFAA holding, and enforcement is active. A node depending on a hostile third party fails verification constantly and teaches you to ignore the Validator. Recorded so it is not quietly re-added. |
| **D21b** | **Permissible sources behind a `ProductivityBenchmarkSource` port.** ACR Career Center · RSNA Career Connect · PracticeLink · Health eCareers · public university/state-system compensation plans (public records — highest quality, zero risk) · practice sites publishing declared productivity (respect `robots.txt`) · MGMA/AMGA/RBMA published abstracts. | Each adapter declares its terms basis. Enforced by `INV-SOURCE-PERMISSIBLE`. |
| **D22** | **AI canvas: full scope as proposed.** | Composer, canvas, fixed tool set, validated chart specs rendered by Swift Charts and Recharts, clinical-refusal guardrail with adversarial evals in CI. |
| **D23** | **Local reminders only.** On-device `UserNotifications`, no APNs. | **Deletes** the `follow_ups` and `push_subscriptions` cloud tables, the `followup-dispatch` cron, and all push infrastructure. Simpler *and* more private — no follow-up metadata ever leaves the device. |

## D24–D27 · The build loop

| ID | Decision | Consequence |
|---|---|---|
| **D24** | **Fine granularity — one contract per node.** ~80–120 nodes. | Maximum Validator leverage, smallest builder context. Orchestration overhead absorbed by the Contractor workflow. |
| **D25** | **Human approval only on Validator `FAIL` or flagged uncertainty.** Agents may act against **production**, including prod migrations and credential rotation. | *User reaffirmed after the risk was raised.* Compensating rails that cost no approval cycles: `INV-PROD-AUDITED` (append-only log of every production action), a mandatory Neon branch snapshot before any prod migration, and a recorded rollback path per node. |
| **D25a** | **PHI never enters agent context.** Vault, redaction and Safe Harbor nodes verify against **synthetic PHI fixtures** byte-shaped like real records. | Not a permission decision — structurally required by G3 and `INV-NO-PHI-IN-CLOUD`. Agent context is a cloud LLM prompt. |
| **D26** | **Maximize quality; cost is secondary.** | Large adversarial fan-out on review, audit and CMS cross-check phases. Multi-lens verification on money, PHI and auth nodes. |
| **D27** | **Sequence honestly, no cuts.** | See the timeline in `docs/ULTRAPLAN.md` §Timeline. Realistic solo estimate is **~8–13 months**, against the proposal's 7–10 months for a *team*. Revising D12 and D14 returned roughly a month to Phase B; D22 and D24 remain the two live expansions. |

---

## D28–D40 · Brownfield decisions (added 2026-08-17 after the codebase audit)

These came from a second founder interview run against the *actual* system rather than the
proposal. Where one of these conflicts with D1–D27, **the working MVP wins** — that is the
founder rule, and it is why D12 and D14 were revised again above.

### Architecture

| ID | Decision | Consequence |
|---|---|---|
| **D28** | **Reference data: one source of truth in a Neon `reference` schema.** Load `~/projects/wrvus/radiology_wrvu_2026_postgres.sql` into a versioned schema. `neurorvu-edge-api` serves it with ETag. iOS keeps a bundled seed purely as an **offline fallback** and syncs on top; the PWA drops its hardcoded table and reads the same API. | Collapses **five** live copies into one: `NeuroRVU.jsx` inline, `lib/data/cms2026-neuro.js`, iOS `cms2026-neuro.json`, edge `api/data/reference.json`, iOS `rvu26a.jsonl`. One write path, two read paths, offline preserved. This is the "definitive database redesign". |
| **D29** | **Keep both Vercel projects; sharpen the contract.** `project-m6jfw` owns **all user data** (exams, extra-duty, KV, auth). `neurorvu-edge-api` owns **reference data and LLM escalation and holds no user rows at all**. | The edge API's privacy story stays trivially statable: it has no user data to leak. Two deploys, two env sets. Both clients call both services. |
| **D31** | **Cloud is the system of record for exams; the device is a durable cache.** Postgres wins conflicts. iOS keeps a local store plus an offline outbox. | Replaces today's emergent local-first fingerprint merge. Clean multi-device story; matches PWA behaviour. Migration must preserve every existing row — the existing `(examDate, cpt, wrvu, site)` fingerprint becomes the reconciliation key **during** migration, then retires. |
| **D39** | **The stack is Neon + Clerk + Vercel.** Not Supabase. | Recorded because the premise was questioned; verified against `vercel env ls` on both projects and `lib/db/index.js` (`@neondatabase/serverless`). |

### Product surface

| ID | Decision | Consequence |
|---|---|---|
| **D32** | **Full iOS GUI redesign with the palette as the only fixed point.** `Theme.swift` hues and semantic roles survive (teal = tracked/regular, amber = extra duty, indigo = benchmarks/imports, per-modality and per-institution colours). Navigation, components and interaction model are open. | Must preserve, explicitly: **consolidated information cards** (the `StatTile` grid) and the **date-selection filter**. The AI canvas is designed in from the start, not bolted on. |
| **D37** | **Tabs: Tracker · Timeline · Data · AI · Settings.** | `Uploads` folds into Tracker as the capture action, where "Log a session" already lives. `Data` merges Exams + Codes (G7). `AI` is the new canvas. `Settings` is promoted from sheet to tab because onboarding, specialties, institutions, sites and rates now need a real home. |
| **D34** | **Full N-institution model with per-institution baseline rows.** New `institutions` and `sites` tables. The reported baseline becomes one row per `(user, institution, period)` instead of the `umYTD`/`jhsYTD` scalars. `exams.site` stays raw free text and **never fails**; mapping to an institution is a user-owned lookup. | Generalises the pattern iOS already has (`nrv_sites` KV + `Institution.overrides`, which falls back to `.other` preserving the raw site). UM and JHS become ordinary rows with no special status. Kills `umYTD`/`jhsYTD`, `repUM`/`repJHS`/`trkUM`/`trkJHS` and the four `["UM","JHS","Other"]` literals — **28 `UM` references in `NeuroRVU.jsx` alone**. |
| **D35** | **Onboarding is skippable; the app works on defaults and prompts later.** Every field has a working default: specialty = all codes, no institutions, rate unset with dollar figures hidden rather than wrong. | The user reaches the Tracker immediately. Contextual prompts appear only where a missing value actually matters (first unmapped site, first dollar display). Nothing is ever a wall. |
| **D36** | **Specialty ranks and defaults; it never restricts.** Specialty tags drive search ordering, quick-add suggestions and OCR mapping priors. All 828 codes stay reachable to everyone. | Neuro and Body ship first. A neuroradiologist reading one chest CT is never blocked and the exam never lands unpriced — the same never-fail-a-row discipline already in `Institution.overrides`. |

### Process

| ID | Decision | Consequence |
|---|---|---|
| **D33** | **The app must always be shippable.** Every node leaves all three deployables working — enforced by `INV-ALWAYS-SHIPPABLE`. Functionality that cannot stand alone is **merged into one coupled node and lands in one PR**. | Chosen as the strict form (interview option 1). |
| **D33a** | **Feature flags are the escape valve, not an exemption.** A node may land incomplete behind a flag that is **off in production**. | Option 1 alone is unachievable in one specific case and pretending otherwise would make the rule a lie — see D33b. Flags carry a named owner and a removal node. |
| **D33b** | **Contract changes are additive-only, and server + both clients ship in the same PR.** | **You cannot ship a server and a TestFlight client atomically.** A user on yesterday's build will call today's API. So: no field is ever removed or retyped in one release; a replacement field is added, both are served, and the old one is dropped only after a release in which no client reads it. This is the reason D33 needs D33a. |
| **D38** | **Improve, never rebuild.** No node may begin by discarding working code. A node that replaces a subsystem must first prove the replacement passes the incumbent's own tests. | The proposal was written as a greenfield plan against a repo whose `ios/` directory was empty. That framing is retired. |
| **D40** | **`~/projects/wrvus` is the reference-data build pipeline and is in scope.** `build_radiology_wrvu_2026.py` already ingests PPRRVU and computes GPCI for three Florida localities. | Extending it to all ~113 CMS localities is a modification to working code, not new construction. It is the input to D28 and the enabler of D12-v3. |

---

## Open items still unresolved

1. ~~**AMA CPT distribution licence**~~ — **closed by D14-v2.** No licensed descriptor text is
   ever persisted, so no licence is required. Reopens only if the product goes commercial
   *and* official descriptor wording is wanted; the `descriptor_source` abstraction is the
   plug point. Node `N15` is retired.
2. **Anthropic BAA** — deferred by D8, conditional on fallback-path volume. Public docs
   conflict on whether Web Search is covered under the post-2026-04-01 HIPAA-configured
   org type; must be confirmed in writing with sales if ever pursued.
3. **MGMA/AMGA data licence** — optional under D21b; check whether the user's department
   already holds one.
4. **US-licensure gate depth** — ships as NPPES + self-attestation
   (`verification_level: 'self_attested'`). FSMB primary-source upgrade stays unfunded.
   Never claim primary-source verification in the UI until it is live.
5. **Institutional media policy** — photographing a worklist may violate employer IT
   policy independent of HIPAA. Onboarding must surface and require acknowledgement.
