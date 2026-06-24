import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { Brain, ShieldCheck } from "lucide-react";
import NeuroRVU from "../../components/NeuroRVU";
import { getCurrentUser, isAdminUser } from "../../lib/auth";

// Protected dashboard (middleware enforces auth). Thin header over the existing
// NeuroRVU app, which persists per-user via /api/store.
export default async function AppPage() {
  const user = await getCurrentUser();
  const admin = isAdminUser(user);

  return (
    <div className="min-h-[100dvh] bg-slate-50">
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-slate-200">
        <div className="mx-auto max-w-6xl px-4 h-12 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-semibold text-slate-800">
            <span className="grid place-items-center w-7 h-7 rounded-lg bg-slate-900">
              <Brain className="w-4 h-4 text-teal-300" />
            </span>
            NeuroRVU
          </Link>
          <div className="flex items-center gap-3">
            {admin && (
              <Link
                href="/admin"
                className="flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 rounded-md border border-slate-200 px-2.5 py-1.5"
              >
                <ShieldCheck className="w-3.5 h-3.5" /> Admin
              </Link>
            )}
            <UserButton afterSignOutUrl="/" />
          </div>
        </div>
      </header>
      <NeuroRVU />
    </div>
  );
}
