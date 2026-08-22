# TestFlight external testing — submission kit

**For Beta App Review of RadRVU (`cc.fella.neurorvu`).** Everything App Store Connect asks
for during external-group setup, ready to paste, plus the criteria audit that backs it.
Companion: `docs/PHI-POSTURE.md` (the evidence), `fella.cc/privacy` (the public policy).

---

## 1. Test Information (paste into App Store Connect)

**Beta App Description**

> RadRVU is a work-RVU productivity tracker for radiologists. Photograph your own
> worklist and it becomes a priced, dated record of what you read — extracted on-device,
> priced against the CMS 2026 fee schedule, and tracked against your monthly benchmark.
> It records what you read, never who you read it on: the app instructs you not to
> capture patient identifiers, stores none, and has no database field to put one in.
> RadRVU is a productivity tool, not a medical device — it never interprets imaging.

**Feedback email:** `mocfelix@gmail.com` *(or an address you prefer testers and Apple to use)*

**Privacy Policy URL:** `https://fella.cc/privacy`

**Marketing URL (optional):** `https://fella.cc`

**What to Test**

> 1. Sign in with the account provided to you (access is invite-only).
> 2. Complete or skip onboarding — every step is skippable; note the patient-privacy step.
> 3. Photograph a worklist showing only procedure, site and date columns; confirm the
>    extracted exams and save. Check the wRVU totals on the Tracker.
> 4. Try the Timeline, Exams, Uploads and Codes tabs; change the Timeline period and
>    confirm it is remembered after relaunch.
> 5. Optional: enable "Cloud sync with fella.cc" in Settings and confirm the same data
>    appears at fella.cc in a browser.

---

## 2. Beta App Review notes (the box reviewers read)

> RadRVU is an invite-only productivity tracker for radiologists (a small professional
> group; no public signup). It is NOT a medical device: it performs no diagnosis and
> never interprets medical images — it OCRs the text of a worklist *list view* the user
> photographs, on-device (Apple Vision), and prices the named procedures against the
> public CMS fee schedule. A persistent disclaimer to this effect is on the main tab.
>
> The app instructs users not to capture patient identifiers (onboarding step 2 and at
> the point of capture) and stores no patient data — see https://fella.cc/privacy.
> Screenshots never leave the device and are not retained after processing.
>
> Sign-in required. Demo account: see below.
>
> DEMO ACCOUNT — ⚠️ founder action, do not skip:
>   email:    <create a fresh account via Admin → "Create user directly">
>   password: <set it there; give Apple that pair here>
> Use an account with a few exams already logged so every tab shows data.

**Why a created account, not an invite:** review must be able to sign in immediately;
"create user directly" (Admin page) makes a ready-to-use email+password with no email
round-trip. Creating it — and setting its password — is a founder action.

---

## 3. Criteria audit — what review checks vs. this codebase

| Criterion | Status | Where |
|---|---|---|
| Privacy policy URL, reachable signed-out | ✅ N61 | `fella.cc/privacy`, public route in `middleware.js` |
| Privacy manifest accurate (`NSPrivacyCollectedDataTypes`) | ✅ N56 | `NeuroRVU/PrivacyInfo.xcprivacy` — email, user id, productivity data; no tracking |
| Export compliance declared | ✅ | `project.yml` → `ITSAppUsesNonExemptEncryption: NO` |
| Non-clinical disclaimer, persistent (G8.6 / INV-NO-CLINICAL) | ✅ N61 | Tracker tab, iOS (`nonClinicalDisclaimer`, pinned by UI test) + PWA footer |
| LLM prompt refuses diagnostic images | ✅ N61 | `lib/ocr-prompt.js` refusal clause → existing `{"valid": false}` path |
| No crash / core flows work | ✅ | 129 iOS tests + UI walks; freeze fixed (N57) |
| Demo account in review notes | ⚠️ founder | §2 above — must be created before submitting |
| Screenshots / app icon | ⚠️ founder | icon is still `brain.head.profile`-era artwork; acceptable for beta, revisit for App Store |
| Account deletion in-app | ▢ deferred | Admin-mediated today (documented in the policy). Required for a public **App Store** listing (5.1.1(v)); generally not enforced at **Beta** review. Tracked. |
| Sign-up inside the iOS app | ▢ untested | Testers should sign up at fella.cc first, then sign in on the phone (What to Test §1 wording assumes this) |

---

## 4. Submission steps (once the above is deployed and a build is cut)

```bash
cd ~/projects/neurorvu-ios
bash scripts/release-testflight.sh     # runs tests, bumps nothing, archives, uploads
```

1. App Store Connect → TestFlight → the new build finishes processing.
2. Create an **External Testing** group (e.g. "Colleagues"); paste §1 into Test Information.
3. Add the build to the group → this triggers **Beta App Review** (typically ~1 day).
4. Approval → invite testers by email, or share the public TestFlight link.
5. Testers install via the TestFlight app. Builds expire after 90 days — plan a refresh.

**Before step 2, in the PWA:** invite each tester's email in Admin (allowlists them), and
remember the invite *email* may not arrive (fella.cc DMARC) — the sign-up link is what works.
