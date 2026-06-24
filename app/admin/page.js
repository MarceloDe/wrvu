import { redirect } from "next/navigation";
import Link from "next/link";
import { clerkClient } from "@clerk/nextjs/server";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { requireAdmin, isAdminUser } from "../../lib/auth";
import AdminClient from "../../components/AdminClient";

export const dynamic = "force-dynamic";

// In-app admin console for user management (list / invite / role / remove).
// Sits on top of Clerk's backend SDK; gated to admins only.
export default async function AdminPage() {
  const admin = await requireAdmin();
  if (!admin) redirect("/app");

  const client = await clerkClient();
  const [userList, inviteList] = await Promise.all([
    client.users.getUserList({ limit: 100, orderBy: "-created_at" }),
    client.invitations.getInvitationList({ status: "pending" }).catch(() => ({ data: [] })),
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
        <AdminClient users={users} invitations={invitations} seatLimit={10} />
      </main>
    </div>
  );
}
