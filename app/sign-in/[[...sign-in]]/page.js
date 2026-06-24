import { SignIn } from "@clerk/nextjs";

export const dynamic = "force-dynamic";

export default function SignInPage() {
  return (
    <main className="metal-bg min-h-[100dvh] grid place-items-center p-6">
      <SignIn
        appearance={{ variables: { colorPrimary: "#14b8a6" } }}
        forceRedirectUrl="/app"
        signUpUrl="/sign-up"
      />
    </main>
  );
}
