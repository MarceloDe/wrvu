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
  try {
    const client = await clerkClient();
    await client.invitations.createInvitation({
      emailAddress: email,
      redirectUrl: `${originFromHeaders()}/sign-up`,
      ignoreExisting: true,
    });
    revalidatePath("/admin");
    return { ok: `Invitation sent to ${email}` };
  } catch (e) {
    return { error: e?.errors?.[0]?.message || String(e) };
  }
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
