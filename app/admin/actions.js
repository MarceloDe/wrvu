"use server";

// Admin server actions for user management. Every action re-verifies the caller
// is an admin before touching Clerk — never trust the client.
//
// Failures return a generic sentence plus the correlation id that also appears
// in the server log line. Clerk's own error text is logged, never rendered
// (INV-NO-RAW-ERRORS); nothing is swallowed (INV-NO-SWALLOW).

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { clerkClient } from "@clerk/nextjs/server";
import { requireAdmin } from "../../lib/auth";
import { newCorrelationId } from "../../lib/http/errors";
import { logServerError } from "../../lib/observability/logger";

function originFromHeaders() {
  const h = headers();
  const host = h.get("x-forwarded-host") || h.get("host");
  const proto = h.get("x-forwarded-proto") || "https";
  return host ? `${proto}://${host}` : "";
}

// Server-side only: the text used to classify a Clerk failure. It is logged,
// never returned to the browser.
function causeText(err) {
  return err?.errors?.[0]?.message || err?.message || Object.prototype.toString.call(err);
}

// The one shape an action failure takes. `ref` is the correlation id.
function actionFailure(action, err, correlationId, sentence) {
  logServerError({
    route: `action ${action}`,
    correlationId,
    code: "internal_error",
    status: 500,
    message: causeText(err),
    cause: err,
  });
  return { error: `${sentence} (ref ${correlationId})` };
}

export async function inviteUser(formData) {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized" };
  const email = String(formData.get("email") || "").trim().toLowerCase();
  if (!email) return { error: "Email required" };

  const correlationId = newCorrelationId();
  const client = await clerkClient();

  // 1) Allowlist the email — reliable fallback so they can sign up directly with
  //    their email even if the invitation email is delayed/spam-filtered (common
  //    on a Clerk development instance). Best-effort: ignore "already exists".
  let allowlisted = true;
  try {
    await client.allowlistIdentifiers.createAllowlistIdentifier({ identifier: email, notify: false });
  } catch (err) {
    const msg = causeText(err).toLowerCase();
    const duplicate = /already|exists|duplicate/.test(msg);
    if (!duplicate) allowlisted = false;
    logServerError({
      route: "action inviteUser",
      correlationId,
      code: duplicate ? "already_allowlisted" : "allowlist_failed",
      status: duplicate ? 200 : 500,
      message: msg,
      cause: duplicate ? undefined : err,
    });
  }

  // 2) Send the invitation — the preferred flow once a production domain is set
  //    up (the ticket link is the cleanest onboarding). Best-effort on duplicates.
  let invited = true;
  try {
    await client.invitations.createInvitation({
      emailAddress: email,
      redirectUrl: `${originFromHeaders()}/sign-up`,
      ignoreExisting: true,
    });
  } catch (err) {
    const msg = causeText(err);
    const duplicate = /already|exists|duplicate/i.test(msg);
    invited = duplicate;
    logServerError({
      route: "action inviteUser",
      correlationId,
      code: duplicate ? "invitation_exists" : "invitation_failed",
      status: duplicate ? 200 : 500,
      message: msg,
      cause: duplicate ? undefined : err,
    });
  }

  revalidatePath("/admin");

  if (!allowlisted && !invited) {
    return { error: `Could not invite or allowlist ${email}. (ref ${correlationId})` };
  }
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

  const correlationId = newCorrelationId();
  const client = await clerkClient();

  // A pending invitation for this email can block direct creation — revoke any
  // first so the address is free to attach to a real user. Non-fatal, but logged.
  try {
    const pend = await client.invitations.getInvitationList({ status: "pending" });
    for (const inv of (pend.data || [])) {
      if (String(inv.emailAddress).toLowerCase() === email) {
        try {
          await client.invitations.revokeInvitation(inv.id);
        } catch (err) {
          logServerError({
            route: "action createUser",
            correlationId,
            code: "revoke_pending_failed",
            status: 200,
            message: causeText(err),
            cause: err,
          });
        }
      }
    }
  } catch (err) {
    logServerError({
      route: "action createUser",
      correlationId,
      code: "list_pending_failed",
      status: 200,
      message: causeText(err),
      cause: err,
    });
  }

  // Allowlist so restricted sign-up mode accepts the address. Non-fatal on dup.
  try {
    await client.allowlistIdentifiers.createAllowlistIdentifier({ identifier: email, notify: false });
  } catch (err) {
    logServerError({
      route: "action createUser",
      correlationId,
      code: "allowlist_failed",
      status: 200,
      message: causeText(err),
      cause: err,
    });
  }

  // Create a verified user with a password directly — no invitation/verification
  // email needed (Backend-API-created emails are trusted as verified). This is
  // the reliable path on a Clerk development instance where emails are flaky.
  try {
    await client.users.createUser({ emailAddress: [email], password, skipPasswordChecks: true });
  } catch (err) {
    return actionFailure("createUser", err, correlationId, `Could not create ${email}.`);
  }

  revalidatePath("/admin");
  return { ok: `${email} created. They can sign in now with the password you set (no email needed).` };
}

export async function revokeInvitation(formData) {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized" };
  const id = String(formData.get("id") || "");
  const correlationId = newCorrelationId();
  try {
    const client = await clerkClient();
    await client.invitations.revokeInvitation(id);
    revalidatePath("/admin");
    return { ok: "Invitation revoked" };
  } catch (err) {
    return actionFailure("revokeInvitation", err, correlationId, "Could not revoke that invitation.");
  }
}

export async function setRole(formData) {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized" };
  const userId = String(formData.get("userId") || "");
  const role = String(formData.get("role") || "user");
  const correlationId = newCorrelationId();
  try {
    const client = await clerkClient();
    await client.users.updateUser(userId, { publicMetadata: { role } });
    revalidatePath("/admin");
    return { ok: `Role updated to ${role}` };
  } catch (err) {
    return actionFailure("setRole", err, correlationId, "Could not update that role.");
  }
}

export async function deleteUser(formData) {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized" };
  const userId = String(formData.get("userId") || "");
  if (userId === admin.id) return { error: "You cannot delete your own account here." };
  const correlationId = newCorrelationId();
  try {
    const client = await clerkClient();
    await client.users.deleteUser(userId);
    revalidatePath("/admin");
    return { ok: "User deleted" };
  } catch (err) {
    return actionFailure("deleteUser", err, correlationId, "Could not delete that user.");
  }
}
