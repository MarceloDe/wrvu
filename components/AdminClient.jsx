"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  UserPlus, Trash2, Shield, ShieldOff, Mail, X, Users, CheckCircle2, AlertTriangle, Loader2,
} from "lucide-react";
import { inviteUser, revokeInvitation, setRole, deleteUser } from "../app/admin/actions";

export default function AdminClient({ users, invitations, seatLimit = 10 }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [banner, setBanner] = useState(null); // { ok } | { error }
  const [email, setEmail] = useState("");

  const run = (action, formData) =>
    startTransition(async () => {
      const res = await action(formData);
      setBanner(res);
      router.refresh();
    });

  const submitInvite = (e) => {
    e.preventDefault();
    const fd = new FormData();
    fd.set("email", email);
    run(inviteUser, fd);
    setEmail("");
  };

  const fd1 = (k, v) => { const f = new FormData(); f.set(k, v); return f; };
  const fd2 = (k1, v1, k2, v2) => { const f = new FormData(); f.set(k1, v1); f.set(k2, v2); return f; };

  const seatsUsed = users.length;

  return (
    <div className="space-y-8">
      {/* Banner */}
      {banner && (
        <div
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
            banner.error ? "bg-red-50 text-red-700 border border-red-200" : "bg-emerald-50 text-emerald-700 border border-emerald-200"
          }`}
        >
          {banner.error ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
          {banner.error || banner.ok}
          <button onClick={() => setBanner(null)} className="ml-auto opacity-60 hover:opacity-100">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Seats + invite */}
      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="flex items-center gap-2 font-semibold text-slate-800">
            <Users className="w-4 h-4 text-slate-500" /> Users
          </h2>
          <span className={`text-xs font-medium px-2 py-1 rounded-full ${seatsUsed >= seatLimit ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
            {seatsUsed} / {seatLimit} seats
          </span>
        </div>

        <form onSubmit={submitInvite} className="flex flex-col sm:flex-row gap-2">
          <div className="flex-1 flex items-center gap-2 border border-slate-200 rounded-lg px-3 py-2">
            <Mail className="w-4 h-4 text-slate-400" />
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@hospital.org"
              className="flex-1 text-sm outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={pending || seatsUsed >= seatLimit}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 text-white text-sm font-medium px-4 py-2 disabled:opacity-50"
          >
            {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
            Invite
          </button>
        </form>
        <p className="mt-2 text-xs text-slate-400">
          Sends a Clerk invitation <span className="font-medium text-slate-500">and</span> allowlists the email — so the person can use the invite link, or just sign up directly with that email if the invite email is delayed. Sign-ups remain restricted to allowlisted/invited people.
        </p>
      </section>

      {/* Users table */}
      <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left font-medium px-4 py-2.5">User</th>
              <th className="text-left font-medium px-4 py-2.5">Role</th>
              <th className="text-right font-medium px-4 py-2.5">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-800">{u.email}</div>
                  <div className="text-xs text-slate-400">{u.name}{u.isSelf ? " · you" : ""}</div>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${u.role === "admin" ? "bg-teal-100 text-teal-700" : "bg-slate-100 text-slate-600"}`}>
                    {u.role}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1.5">
                    {u.role === "admin" ? (
                      <button
                        onClick={() => run(setRole, fd2("userId", u.id, "role", "user"))}
                        disabled={pending || u.isSelf}
                        title="Revoke admin"
                        className="inline-flex items-center gap-1 text-xs text-slate-600 border border-slate-200 rounded-md px-2 py-1 disabled:opacity-40 hover:bg-slate-50"
                      >
                        <ShieldOff className="w-3.5 h-3.5" /> Make user
                      </button>
                    ) : (
                      <button
                        onClick={() => run(setRole, fd2("userId", u.id, "role", "admin"))}
                        disabled={pending}
                        title="Make admin"
                        className="inline-flex items-center gap-1 text-xs text-slate-600 border border-slate-200 rounded-md px-2 py-1 disabled:opacity-40 hover:bg-slate-50"
                      >
                        <Shield className="w-3.5 h-3.5" /> Make admin
                      </button>
                    )}
                    <button
                      onClick={() => run(deleteUser, fd1("userId", u.id))}
                      disabled={pending || u.isSelf}
                      title="Remove user"
                      className="inline-flex items-center gap-1 text-xs text-red-600 border border-red-200 rounded-md px-2 py-1 disabled:opacity-40 hover:bg-red-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Pending invitations */}
      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="flex items-center gap-2 font-semibold text-slate-800 mb-3">
          <Mail className="w-4 h-4 text-slate-500" /> Pending invitations
        </h2>
        {invitations.length === 0 ? (
          <p className="text-sm text-slate-400">No pending invitations.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {invitations.map((i) => (
              <li key={i.id} className="flex items-center justify-between py-2.5">
                <div>
                  <div className="text-sm text-slate-800">{i.email}</div>
                  <div className="text-xs text-slate-400">{i.status}</div>
                </div>
                <button
                  onClick={() => run(revokeInvitation, fd1("id", i.id))}
                  disabled={pending}
                  className="inline-flex items-center gap-1 text-xs text-red-600 border border-red-200 rounded-md px-2 py-1 disabled:opacity-40 hover:bg-red-50"
                >
                  <X className="w-3.5 h-3.5" /> Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
