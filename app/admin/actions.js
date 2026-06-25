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
