import { auth } from "@clerk/nextjs/server";
import Landing from "../components/Landing";
import { adminEmails } from "../lib/auth";

// Public marketing landing page.
export default async function Page() {
  const { userId } = await auth();
  const admin = adminEmails()[0] || "";
  return <Landing isSignedIn={Boolean(userId)} adminEmail={admin} />;
}
