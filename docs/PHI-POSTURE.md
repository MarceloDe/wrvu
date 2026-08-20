# RadRVU — patient-data posture

**Version 0.2.0 · 2026-08-20 · written for TestFlight Beta App Review**

Every claim here names the code that makes it true, so a reviewer can check it rather than
take it on trust. Where something is a limitation, it is stated as one. A document that
claimed perfection would invite exactly the scrutiny it is trying to avoid.

---

## 1. What the app is

RadRVU is a **productivity tracker for the physician's own work**. A radiologist
photographs their own worklist, and the app turns it into a dated, CMS-priced record of
how many studies they read and what those studies are worth in work RVUs.

It measures the doctor. It is not about any patient.

**It is not a medical device and performs no clinical function.** It never interprets an
image, never reads a DICOM viewport, and never produces a finding, an impression or a
recommendation. Extracting text from a worklist *user interface* is not image analysis.
This boundary is a stated invariant, `INV-NO-CLINICAL` (`goals/INVARIANTS.yaml:237-251`).

Distribution is **invite-only** to a small group of colleagues. There is no public signup
and no billing.

---

## 2. What the user is instructed to do

The physician is told, inside the product, not to capture patient identifiers — before
they are ever shown a photo picker.

**Onboarding, step 2 of 7 — "Patient privacy"** (iOS `NeuroRVU/Onboarding/OnboardingFlow.swift`,
web `components/onboarding/Onboarding.jsx`):

> **Do not capture patient identifiers**
>
> Photograph only the procedure, site and date columns of your worklist. Never include
> patient names, medical record numbers, dates of birth or accession numbers.
>
> RadRVU records what you read, not who you read it on. It has no field to store a patient
> identifier in.
>
> Photographing a worklist may also breach your institution's own media or IT policy,
> separately from any patient-privacy rule. Check before you do.

**Restated at the point of capture**, directly under the photo picker, on every use
(iOS `LogSessionCard.swift`, web `components/analytics/Tracker.jsx`):

> Procedure, site and date columns only — no patient names or MRNs.

**The acknowledgement is recorded** — a timestamp, not a boolean, written to
`nrv_onboarding` (`privacyAcknowledgedAt`). Skipping the step records **null**, never a
fabricated acknowledgement: a compliance record that is not true is worse than none.

Consistent with the product's accessibility principle (D35), the step is skippable and the
app stays fully usable if it is skipped. An app that refused to run because someone
dismissed a notice would be a wall, and it would protect nobody.

---

## 3. What is stored

**No patient-identifier field exists anywhere in this system.** Not in the cloud database,
not in the iOS local store.

Verified by introspecting the live schema on 2026-08-20 — **103 columns** across the
`public` and `reference` schemas, scanned for `mrn|patient|accession|dob|birth|ssn|
first_name|last_name|surname|phone|email|image|photo|blob|base64`:

```
NONE — no patient-identifier or image column in either schema
```

The exam record is: CPT code, procedure description, facility label, modality, work RVU,
exam date, and the physician's own user id. There is **no patient dimension** — no column
to join a study to a person, because no such column exists.

Enforced continuously by `scripts/verify/phi-schema-scan.mjs`, which introspects the live
database and fails the build on any column matching the identifier list.

**No image is stored anywhere.** There is no blob column, no object storage, and no
filesystem retention. On iOS a picked screenshot is parsed in memory and discarded;
`ImageUploadSweeper` also deletes any screenshot an earlier build had retained.

**Row-level security** is enforced with `FORCE ROW LEVEL SECURITY`, which binds even the
table owner. The application connects as a non-superuser role (`app_rls`) and every query
is scoped to the signed-in physician. `INV-NO-PEER-DATA` forbids any cross-user aggregate.

---

## 4. What leaves the device

### iOS — no image ever leaves

OCR runs **entirely on-device** using Apple's Vision framework
(`NeuroRVU/Pipeline/OCRService.swift`). The app has no code path that uploads an image;
it cannot take a photo at all, and receives images only from the system photo picker.

When on-device extraction is ambiguous, the app may ask the server to arbitrate between
candidate CPT codes. That path is:

- **Default-deny and per-upload.** Nothing is sent unless the user taps send on a consent
  sheet that displays the **exact strings** that would leave the device
  (`NeuroRVU/Views/ConsentSheet.swift`).
- **De-identified first.** Fragments pass through `Redaction.redact`
  (`EscalationService.swift`), which strips MRN/DOB/SSN-labelled values, SSN and date
  shapes, digit runs, labelled and comma-form names, emails, URLs and phone numbers — and
  then requires every remaining alphabetic token to be a member of a 1,020-token clinical
  vocabulary. Anything unrecognised becomes `[?]`. It **fails closed**, so a name is
  dropped whether or not any dictionary contains it.
- **Capped and screened server-side.** At most 40 fragments of 120 characters, and any
  fragment matching an MRN/DOB/SSN shape is rejected. Request bodies are never logged and
  never persisted.

Exam dates transmitted from iOS are truncated to **day precision** for HIPAA Safe Harbor
(`CloudSyncService.swift`). Cloud sync is **opt-in and off by default**.

### Web — the image is masked before any network call

The browser app sends worklist images to Anthropic for OCR, and **cannot send an
unredacted one**:

- The user marks the patient-name and MRN columns once per institution. An image block
  cannot be constructed unless **both** regions exist (`lib/redact/imageRedactor.ts`).
- Masked pixels are written into the pixel buffer and the image is **re-encoded**. They
  are destroyed, not covered by an overlay.
- All of this happens in the browser, before any request. A static AST check
  (`scripts/verify/no-unredacted-path.mjs`) enforces that image blocks are built only
  inside the redaction module, that exactly one upload call exists, and that the approval
  guard runs **before** it.

---

## 5. Limits, stated plainly

- **Web masking covers the two columns the user marks.** A date of birth, accession number
  or referring-physician column elsewhere on the image is not masked. The instruction in
  §2 is the primary control; masking is a backstop.
- **PDFs bypass masking, by design.** That path carries the physician's own HR
  productivity report — their compensation, not patient data. It is restricted to PDFs by
  an automated check.
- **Web exam dates are stored at second precision.** Under HIPAA Safe Harbor any date more
  precise than a year is an identifier, so the cloud store is best described as a *limited
  data set* rather than de-identified data. iOS already truncates to day; the web app does
  not yet. Tracked as open work.
- **No Business Associate Agreement is in place** with Anthropic, Neon, Vercel or Clerk.
  The architecture is designed so that none should be required — no patient identifier is
  collected or stored — but no BAA has been executed and this document does not imply one.
- **A physician could still photograph an identifier despite being told not to.** The
  instruction, the capture-point reminder, the web masking backstop and the absence of any
  column to store an identifier in are four independent layers; none is a guarantee about
  what a person points a camera at.

---

## 6. Third parties

| Service | Receives | Patient data? |
|---|---|---|
| **Clerk** | Physician email + user id (sign-in) | No |
| **Neon** (Postgres) | The physician's own exam rows | No — no patient column exists |
| **Anthropic** | Web: masked worklist image. iOS: consented, de-identified text fragments | No identifier by design; see §5 |
| **Vercel** | Hosting | No |

There is no analytics SDK, no advertising SDK, no crash reporter and no tracking. The
privacy manifest declares `NSPrivacyTracking = false` with an empty tracking-domains list,
and `NSPrivacyCollectedDataTypes` declares exactly what §6 lists — the physician's own
email, user id and productivity data, all as *App Functionality*, none linked to tracking.

---

## 7. Verification

| Claim | Check |
|---|---|
| No PHI column exists | `scripts/verify/phi-schema-scan.mjs` (live introspection) |
| No unredacted image can be uploaded | `scripts/verify/no-unredacted-path.mjs` (AST) |
| Redaction destroys pixels | `npm run test:redaction` |
| iOS retains no screenshot | `NeuroRVUTests/ImageRetentionTests.swift` |
| Instruction is present and skippable | `scripts/verify/onboarding-skip.mjs`, `NeuroRVUTests/OnboardingModelTests.swift` |
| No PHI in logs | `scripts/verify/phi-log-scan.mjs --stream <session.log>` |
| No PHI in auth metadata | `scripts/verify/clerk-callsite-scan.mjs` |

All PHI-related tests use **synthetic fixtures only**. Real patient data never enters a
test, a CI run or a developer tool (D25a).
