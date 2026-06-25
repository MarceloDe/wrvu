// Configure Clerk invite-only restrictions WITHOUT the dashboard, using the
// Clerk Backend (Management) API with the CLERK_SECRET_KEY already injected into
// this Vercel deployment. Token-gated like /api/setup. Idempotent.
//
//   curl -X POST https://<deployment>/api/setup-clerk -H "x-setup-token: $SETUP_TOKEN"
//
// What it does:
//   1) Enables allowlist mode  -> sign-ups restricted to allowlisted/invited emails
//   2) Allowlists each ADMIN_EMAILS address
//   3) Sends an invitation to each admin email so you can create your account
//
// After this, the in-app /admin page (invitations.createInvitation) is how you
// add the other users — no Clerk dashboard required.

export const runtime = "nodejs";
export const maxDuration = 60;

const CLERK_API = "https://api.clerk.com/v1";

function adminEmails() {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

async function clerk(path, method, body) {
  const r = await fetch(`${CLERK_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await r.json(); } catch {}
  return { status: r.status, data };
}

async function handle(req) {
  const token = req.headers.get("x-setup-token");
  if (!process.env.SETUP_TOKEN || token !== process.env.SETUP_TOKEN) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  if (!process.env.CLERK_SECRET_KEY) {
    return Response.json({ error: "CLERK_SECRET_KEY missing" }, { status: 500 });
  }

  const origin = new URL(req.url).origin;
  const emails = adminEmails();
  const results = { restrictions: null, allowlist: [], invitations: [] };

  // 1) Enable allowlist (restricted sign-ups).
  results.restrictions = await clerk("/instance/restrictions", "PATCH", {
    allowlist: true,
    blocklist: false,
  });

  // 2) Allowlist + 3) invite each admin email.
  for (const email of emails) {
    const allow = await clerk("/allowlist_identifiers", "POST", { identifier: email, notify: false });
    results.allowlist.push({ email, status: allow.status, error: allow.data?.errors?.[0]?.message || null });

    const invite = await clerk("/invitations", "POST", {
      email_address: email,
      redirect_url: `${origin}/sign-up`,
      ignore_existing: true,
    });
    results.invitations.push({ email, status: invite.status, error: invite.data?.errors?.[0]?.message || null });
  }

  const ok =
    results.restrictions.status < 300 &&
    results.allowlist.every((a) => a.status < 300 || /already|exists/i.test(a.error || "")) &&
    results.invitations.every((i) => i.status < 300 || /already|exists|duplicate/i.test(i.error || ""));

  return Response.json({ ok, emails, results });
}

export const POST = handle;
export const GET = handle;
