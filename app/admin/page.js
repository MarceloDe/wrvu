import { redirect } from "next/navigation";
import Link from "next/link";
import { clerkClient } from "@clerk/nextjs/server";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { requireAdmin, isAdminUser } from "../../lib/auth";
import AdminClient from "../../components/AdminClient";
import { newCorrelationId } from "../../lib/http/errors";
import { logServerError } from "../../lib/observability/logger";

export const dynamic = "force-dynamic";

// In-app admin console for user management (list / invite / role / remove).
// Sits on top of Clerk's backend SDK; gated to admins only.
export default async function AdminPage() {
  const admin = await requireAdmin();
  if (!admin) redirect("/app");

  const client = await clerkClient();
  // The invitation list is non-essential — the page still works without it — but
  // its failure is logged and shown, never swallowed (INV-NO-SWALLOW).
  let invitationsError = null;
  const [userList, inviteList] = await Promise.all([
    client.users.getUserList({ limit: 100, orderBy: "-created_at" }),
    client.invitations.getInvitationList({ status: "pending" }).catch((err) => {
      const correlationId = newCorrelationId();
      logServerError({
        route: "page /admin",
        correlationId,
        code: "invitation_list_failed",
        status: 200,
        message: "pending invitations could not be listed",
        cause: err,
      });
      invitationsError = `Pending invitations could not be loaded. (ref ${correlationId})`;
      return { data: [] };
    }),
  ]);

  const users = (userList.data || []).map((u) => ({
    id: u.id,
    email: u.primaryEmailAddress?.emailAddress || u.emailAddresses?.[0]?.emailAddress || "—",
    name: [u.firstName, u.lastName].filter(Boolean).join(" ") || "—",
    role: isAdminUser(u) ? "admin" : "user",
    isSelf: u.id === admin.id,
    createdAt: u.createdAt,
    lastSignInAt: u.lastSignInAt,
  }));

  const invitations = (inviteList.data || []).map((i) => ({
    id: i.id,
    email: i.emailAddress,
    status: i.status,
    createdAt: i.createdAt,
  }));

  return (
    <div className="min-h-[100dvh] bg-slate-50">
      <header className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-slate-200">
        <div className="mx-auto max-w-4xl px-4 h-12 flex items-center justify-between">
          <Link href="/app" className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
            <ArrowLeft className="w-4 h-4" /> Back to app
          </Link>
          <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
            <ShieldCheck className="w-4 h-4 text-teal-600" /> Admin
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-8">
        {invitationsError && (
          <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{invitationsError}</p>
        )}
        {/* 100, raised from 10 for the 15-tester TestFlight rollout. UI-only guard —
            nothing server-side enforces it — so its job is honesty in the header and
            disabling the buttons, not security. Sign-ups stay gated by the Clerk
            allowlist regardless. */}
        <AdminClient users={users} invitations={invitations} seatLimit={100} />
      </main>
    </div>
  );
}
