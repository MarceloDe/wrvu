"use server";

// Admin server actions for user management. Every action re-verifies the caller
// is an admin before touching Clerk — never trust the client.

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { clerkClient } from "@clerk/nextjs/server";
import { requireAdmin } from "../../lib/auth";

function originFromHeaders() {
  const h = headers();
  const host = h.get("x-forwarded-host") || h.get("host");
  const proto = h.get("x-forwarded-proto") || "https";
  return host ? `${proto}://${host}` : "";
}

export async function inviteUser(formData) {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized" };
  const email = String(formData.get("email") || "").trim().toLowerCase();
  if (!email) return { error: "Email required" };

  const client = await clerkClient();

  // 1) Allowlist the email — reliable fallback so they can sign up directly with
  //    their email even if the invitation email is delayed/spam-filtered (common
  //    on a Clerk development instance). Best-effort: ignore "already exists".
  let allowlisted = true;
  try {
    await client.allowlistIdentifiers.createAllowlistIdentifier({ identifier: email, notify: false });
  } catch (e) {
    const msg = (e?.errors?.[0]?.message || String(e)).toLowerCase();
    if (!/already|exists|duplicate/.test(msg)) allowlisted = false;
  }

  // 2) Send the invitation — the preferred flow once a production domain is set
  //    up (the ticket link is the cleanest onboarding). Best-effort on duplicates.
  let invited = true;
  let inviteErr = null;
  try {
    await client.invitations.createInvitation({
      emailAddress: email,
      redirectUrl: `${originFromHeaders()}/sign-up`,
      ignoreExisting: true,
    });
  } catch (e) {
    const msg = e?.errors?.[0]?.message || String(e);
    if (/already|exists|duplicate/i.test(msg)) { invited = true; }
    else { invited = false; inviteErr = msg; }
  }

  revalidatePath("/admin");

  if (!allowlisted && !invited) return { error: inviteErr || "Could not invite or allowlist this email." };
  if (allowlisted && invited) return { ok: `${email} invited and allowlisted — they can use the invite link OR sign up directly.` };
  if (allowlisted) return { ok: `${email} allowlisted (invite email could not be sent) — they can sign up directly now.` };
  return { ok: `Invitation sent to ${email}.` };
}

export async function createUser(formData) {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized" };
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  if (!email) return { error: "Email required" };
  if (password.length < 8) return { error: "Password must be at least 8 characters" };

  const client = await clerkClient();

  // A pending invitation for this email can block direct creation — revoke any
  // first so the address is free to attach to a real user.
  try {
    const pend = await client.invitations.getInvitationList({ status: "pending" });
    for (const inv of (pend.data || [])) {
      if (String(inv.emailAddress).toLowerCase() === email) {
        await client.invitations.revokeInvitation(inv.id).catch(() => {});
      }
    }
  } catch { /* non-fatal */ }

  // Allowlist so restricted sign-up mode accepts the address. Non-fatal on dup.
  try {
    await client.allowlistIdentifiers.createAllowlistIdentifier({ identifier: email, notify: false });
  } catch { /* keep going — creation is the real test */ }

  // Create a verified user with a password directly — no invitation/verification
  // email needed (Backend-API-created emails are trusted as verified). This is
  // the reliable path on a Clerk development instance where emails are flaky.
  try {
    await client.users.createUser({ emailAddress: [email], password, skipPasswordChecks: true });
  } catch (e) {
    const err = e?.errors?.[0];
    const msg = err ? `${err.code || ""}: ${err.longMessage || err.message || ""}`.trim() : String(e?.message || e);
    return { error: `Create failed — ${msg}` };
  }

  revalidatePath("/admin");
  return { ok: `${email} created. They can sign in now with the password you set (no email needed).` };
}

export async function revokeInvitation(formData) {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized" };
  const id = String(formData.get("id") || "");
  try {
    const client = await clerkClient();
    await client.invitations.revokeInvitation(id);
    revalidatePath("/admin");
    return { ok: "Invitation revoked" };
  } catch (e) {
    return { error: String(e) };
  }
}

export async function setRole(formData) {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized" };
  const userId = String(formData.get("userId") || "");
  const role = String(formData.get("role") || "user");
  try {
    const client = await clerkClient();
    await client.users.updateUser(userId, { publicMetadata: { role } });
    revalidatePath("/admin");
    return { ok: `Role updated to ${role}` };
  } catch (e) {
    return { error: String(e) };
  }
}

export async function deleteUser(formData) {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized" };
  const userId = String(formData.get("userId") || "");
  if (userId === admin.id) return { error: "You cannot delete your own account here." };
  try {
    const client = await clerkClient();
    await client.users.deleteUser(userId);
    revalidatePath("/admin");
    return { ok: "User deleted" };
  } catch (e) {
    return { error: String(e) };
  }
}
