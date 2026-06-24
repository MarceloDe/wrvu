// Server-side auth helpers. Admin is granted either by Clerk publicMetadata
// (role: "admin") or by listing an email in the ADMIN_EMAILS env var — so you
// are an admin out of the box without having to hand-edit metadata first.

import { auth, clerkClient } from "@clerk/nextjs/server";

export function adminEmails() {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminUser(user) {
  if (!user) return false;
  if (user.publicMetadata?.role === "admin") return true;
  const allow = adminEmails();
  return (user.emailAddresses || []).some((e) =>
    allow.includes(String(e.emailAddress).toLowerCase()),
  );
}

export async function getCurrentUser() {
  const { userId } = await auth();
  if (!userId) return null;
  const client = await clerkClient();
  return client.users.getUser(userId);
}

// Returns the admin user or null. Use in admin pages / actions to gate access.
export async function requireAdmin() {
  const user = await getCurrentUser();
  return isAdminUser(user) ? user : null;
}
