// The privacy policy, as a public page.
//
// This exists because TestFlight external testing requires a privacy-policy URL in the
// Test Information, and Beta App Review follows that URL without an account — so it is
// listed in middleware.js's public routes. Until now no policy page existed anywhere;
// docs/PHI-POSTURE.md held the substance but only inside the repo.
//
// Every claim below is the user-facing rendering of a claim in docs/PHI-POSTURE.md,
// which cites the code behind it. Keep the two in step: if a data practice changes,
// PHI-POSTURE.md changes, and then this page.
export const metadata = { title: "RadRVU — Privacy Policy" };

const EFFECTIVE = "August 22, 2026";

function H({ children }) {
  return <h2 className="text-lg font-semibold text-slate-900 mt-8 mb-2">{children}</h2>;
}
function P({ children }) {
  return <p className="text-sm text-slate-600 leading-relaxed mb-3">{children}</p>;
}

export default function PrivacyPage() {
  return (
    <main className="max-w-2xl mx-auto px-5 py-12">
      <h1 className="text-2xl font-bold text-slate-900">RadRVU Privacy Policy</h1>
      <p className="text-xs text-slate-400 mt-1 mb-6">Effective {EFFECTIVE} · applies to the RadRVU iOS app and fella.cc</p>

      <P>
        RadRVU is a work-RVU productivity tracker for radiologists. It records <strong>what you
        read — never who you read it on</strong>. It is not a medical device, performs no clinical
        function, and never interprets medical images.
      </P>

      <H>Patient information</H>
      <P>
        RadRVU stores no patient information. No field for a patient name, medical record number,
        date of birth or accession number exists in our database or in the app&apos;s on-device
        storage. You are instructed, during setup and at every capture, to photograph only the
        procedure, site and date columns of your worklist.
      </P>
      <P>
        As a backstop on the web app, worklist images are masked <em>in your browser</em> — the
        marked pixels are destroyed before any upload — or you may confirm the capture contains no
        patient columns. On iOS, screenshots are processed entirely on-device with Apple&apos;s
        Vision framework, are never uploaded, and are not retained after processing.
      </P>

      <H>What we collect</H>
      <P>
        Your email address and a user id (for sign-in, via Clerk), and — only if you enable cloud
        sync — your own productivity records: CPT code, procedure description, facility label,
        work-RVU value, and the exam date at day precision. All of it describes your work, not any
        patient&apos;s health.
      </P>

      <H>AI processing</H>
      <P>
        On the web app, a redacted worklist image or your own HR productivity report is sent to
        Anthropic&apos;s Claude API to extract exam rows or monthly totals. On iOS, extraction runs
        on-device; if a procedure name is ambiguous you may explicitly consent — per upload, shown
        the exact text — to send short, de-identified procedure fragments for code arbitration.
        Nothing is sent without that consent, and images are never sent from iOS at all.
      </P>

      <H>Storage and access</H>
      <P>
        Cloud data lives in a Postgres database (Neon) with row-level security enforced for every
        request — each account can only ever read its own rows. Hosting is on Vercel;
        authentication is by Clerk. API keys for AI processing are held server-side only. We use no
        analytics SDK, no advertising SDK, and no tracking of any kind.
      </P>

      <H>Retention and deletion</H>
      <P>
        Your data persists until you delete it. Exams can be deleted in-app by day, by upload or by
        batch. For full account deletion, contact the administrator who invited you and your
        account and its rows will be removed.
      </P>

      <H>Not medical advice</H>
      <P>
        RadRVU is a productivity tool. It does not diagnose, treat, or interpret imaging, and its
        wRVU figures are informational — not official billing or compensation advice.
      </P>

      <H>Contact</H>
      <P>
        Questions or deletion requests: the administrator who invited you, or the feedback address
        shown in TestFlight.
      </P>
    </main>
  );
}
