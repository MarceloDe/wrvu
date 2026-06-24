import { SignUp } from "@clerk/nextjs";

export const dynamic = "force-dynamic";

// Sign-up is invite-only (enforced in the Clerk dashboard: Restrictions →
// "Allowlist" / sign-ups via invitation only). Users without an invitation will
// see Clerk's "sign-ups are restricted" message here.
export default function SignUpPage() {
  return (
    <main className="metal-bg min-h-[100dvh] grid place-items-center p-6">
      <SignUp
        appearance={{ variables: { colorPrimary: "#14b8a6" } }}
        forceRedirectUrl="/app"
        signInUrl="/sign-in"
      />
    </main>
  );
}
