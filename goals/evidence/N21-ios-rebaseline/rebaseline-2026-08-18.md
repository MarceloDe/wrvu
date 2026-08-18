# N21 — iOS re-baseline

Audited against `neurorvu-ios` @ `5bbae8a`, working tree **clean** (N20x landed).
Every claim below was measured, not read off the plan.

## Q1 — What does the shipping app already satisfy?

| Phase C node | State | Evidence |
|---|---|---|
| `N21` Xcode project, SPM, Clerk auth | **DONE** | XcodeGen `project.yml`, ClerkKit/ClerkKitUI via SPM, TestFlight build 1 VALID |
| `N24` Vision OCR | **DONE + hardened** | `OCRService` + `ParserService` + fixtures; 52/52 on iOS 26.5 after N20x |
| `N25` de-identification | **PARTIAL — see Q2** | `Redaction.redact()` covers 4 patterns of the Safe Harbor 18 |
| `N28` offline outbox | **PARTIAL** | `CloudSyncService` has fingerprint merge, pull-only recovery, "replace local with cloud". No durable write-ahead outbox. |
| `N26` pricing parity | **HOLDS, but by duplication** | see Q6 |
| `N23` SQLCipher vault | **NOT STARTED** | no GRDB, SQLCipher, Keychain key or `LAContext` anywhere |
| `N22` openapi + generated clients | **NOT STARTED** | hand-written `URLRequest` in `CloudSyncService` / `EscalationService` |
| `N27` worklist layout profiles | **NOT STARTED** | column mapping is heuristic, not user-tagged |
| `N29` PHI CI gate | **NOT STARTED** | |
| `N30` GUI redesign | **NOT STARTED** | 5 tabs as built |

## Q2 — Redaction vs the Safe Harbor 18

`EscalationService.Redaction.redact()` applies four rules:

1. labelled `MRN|DOB|SSN` plus the following token
2. SSN-shaped `\d{3}-\d{2}-\d{4}`
3. date-shaped `\d{1,2}[/-]\d{1,2}[/-]\d{2,4}`
4. digit runs of 5+ (MRN/accession-shaped; small CPT numbers survive)

**The largest gap is names — they are not redacted at all.** A patient name sitting in a
procedure fragment reaches `/api/v1/resolve` unmasked. Also absent: email, phone, fax, URL,
IP, vehicle/device/licence identifiers, and the 90+ age rule.

Roughly **4 of 18 identifiers** are covered. This is materially short of `G3.5`
("property-tested against all 18"), and names are the one a worklist actually contains.

Mitigating, and real: the escalation path sends only short *procedure-text fragments*
under hard caps (`MAX_FRAGMENTS 40`, `MAX_FRAGMENT_LENGTH 120`), behind a per-upload
consent sheet, and the edge API independently rejects `dob|mrn|ssn`-shaped content. The
image itself never leaves the device.

## Q3 — Does anything identifying reach the cloud?

**No patient identifier FIELD exists in any SwiftData model.** Not `patient`, `mrn`,
`accession` or `dob` — verified across all of `NeuroRVU/Models/`. The exam payload is
`id, batchId, examDate, cpt, procedure, site, institution, modality, wrvu, estimated,
source, uploadedAt`.

**One real finding: `examDate` is transmitted at full ISO8601 second precision**
(`CloudSyncService.swift:177`). Under HIPAA Safe Harbor any date more specific than the
year is an identifier, so the cloud store is a *limited data set*, not de-identified data —
exactly the §1.8 analysis in the proposal, now confirmed against the shipping app rather
than inferred. `D` requires day precision in the cloud and second precision on device only.

The KV channel is **bounded**, not arbitrary: only `nrv_sites`, `nrv_settings`,
`nrv_baseline` are ever pushed.

## Q4 — MFA and app lock

**Neither exists.** Zero matches for `LAContext`, biometric, Face ID, app lock, MFA or
second-factor across `Auth/` and `App/`. Consistent with the Clerk dashboard finding that
no MFA strategy is enabled at all. `G8` (app lock) and `G9.1` (MFA) are both unstarted on
the client.

## Q5 — Does the FoundationModels path need INV-NO-CLINICAL?

There is **no clinical-refusal clause**. The `refused(reason:)` cases in `ParserService`
are the "this is not a worklist" refusal, not a clinical one.

Risk is currently **low by construction rather than by control**: the session instructions
scope the model to mapping one procedure name to a CPT from a supplied reference list, and
the output is a structured type — it is not an open chat surface. But `INV-NO-CLINICAL` is
unenforced here, and `N48` must cover the on-device path, not just the cloud route.

## Q6 — iOS / PWA wRVU parity, before any shared engine

Measured code-for-code:

```
iOS seed  : 61 codes        PWA table : 61 codes
only in iOS: 0              only in PWA: 0
wRVU disagreements: 0       CF: 33.4 vs 33.40
-> PARITY HOLDS
```

The `ReferenceSeeder` comment claiming a verbatim export of `wruvs/lib/data/cms2026-neuro.js`
is **true today**. It holds by duplication, not by construction — nothing prevents the two
from drifting, which is precisely what `N26` and `INV-PARITY` exist to fix.

## Q7 — The uncommitted files

**Resolved.** Committed as `5bbae8a` with the contrast fix. Tree is clean.

---

## Re-baselined Phase C

The withdrawn estimate was 12–20 weeks as greenfield. Xcode, Vision OCR, Clerk auth, cloud
sync, CloudKit backup, the privacy manifest and the TestFlight pipeline are all done, so
what remains is:

| Node | Work | Estimate |
|---|---|---|
| `N22` contracts + generated clients | new | ~1 wk |
| `N23` SQLCipher vault | genuinely new — the app is redact-and-discard, not vault-and-retain | 2–3 wk |
| `N25` redaction to Safe Harbor 18 | extend 4 rules to 18, names first | ~1 wk |
| `N26` pricing parity on a shared engine | gated on Phase B | ~1 wk after B |
| `N27` layout profiles + column tagger | new | ~2 wk |
| `N28` durable outbox | partial exists | ~1 wk |
| `N29` PHI CI gate | new | ~3 d |
| `N30` GUI redesign | new | 3–4 wk |
| `N20y` iOS 27 Vision `.noTable` | unknown | ? |

**Phase C ≈ 10–14 weeks**, down from 12–20, and the composition is different: less
construction, more hardening.

## Three things that should not wait for their phase

1. **`examDate` second precision** — a live Safe Harbor issue in the shipping app. Truncating
   to day in the sync payload is a small change with real compliance value.
2. **Names are unredacted** — the single most likely identifier in a worklist, and the one
   rule the redactor lacks.
3. **`N20y`** — pin the CI runtime or CI is red on iOS 27 for reasons unrelated to the code.
