// Clerk configuration + diagnostics via the Backend API (token-gated).
//
//   GET  ?inspect=1                 -> restrictions + pending invitations + allowlist
//   POST                            -> enable allowlist mode; allowlist+invite ADMIN_EMAILS;
//                                      ALSO allowlist every pending-invitation email so invited
//                                      users can sign up directly even if the email didn't arrive
//   POST ?action=create-user        -> body {email,password}: create a verified user with no
//                                      email round-trip (most reliable for a dev-instance pilot)

export const runtime = "nodejs";
export const maxDuration = 60;

const CLERK_API = "https://api.clerk.com/v1";

function adminEmails() {
  return (process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

async function clerk(path, method, body) {
  const r = await fetch(`${CLERK_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await r.json(); } catch {}
  return { status: r.status, data };
}

const asList = (d) => (Array.isArray(d) ? d : (d?.data || []));

function gate(req) {
  const token = req.headers.get("x-setup-token");
  if (!process.env.SETUP_TOKEN || token !== process.env.SETUP_TOKEN) return false;
  return Boolean(process.env.CLERK_SECRET_KEY);
}

export async function GET(req) {
  if (!gate(req)) return Response.json({ error: "not found" }, { status: 404 });
  if (!new URL(req.url).searchParams.get("inspect")) {
    return Response.json({ error: "use ?inspect=1 (GET) or POST" }, { status: 400 });
  }
  const [restr, inv, allow] = await Promise.all([
    clerk("/instance/restrictions", "GET"),
    clerk("/invitations?status=pending&limit=100", "GET"),
    clerk("/allowlist_identifiers?limit=100", "GET"),
  ]);
  const invitations = asList(inv.data).map((i) => ({ email: i.email_address, status: i.status, createdAt: i.created_at }));
  const allowlist = asList(allow.data).map((a) => a.identifier);
  return Response.json({
    restrictions: restr.data,
    invitations,
    allowlist,
    note: "Development-instance emails (invites + verification codes) are sent from Clerk's shared sender and are frequently delayed or spam-filtered by Gmail. 'pending' means the record exists, NOT that the email was delivered.",
  });
}

export async function POST(req) {
  if (!gate(req)) return Response.json({ error: "not found" }, { status: 404 });
  const origin = new URL(req.url).origin;
  const action = new URL(req.url).searchParams.get("action");

  // Create a verified user directly — no invitation/verification email needed.
  if (action === "create-user") {
    let body;
    try { body = await req.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!email || password.length < 8) return Response.json({ error: "email + password (>=8 chars) required" }, { status: 400 });
    // Allowlist first so restricted mode accepts the address.
    await clerk("/allowlist_identifiers", "POST", { identifier: email, notify: false });
    const res = await clerk("/users", "POST", {
      email_address: [email],
      password,
      skip_password_checks: true,
    });
    const ok = res.status < 300;
    return Response.json({ ok, email, error: ok ? null : (res.data?.errors?.[0]?.message || res.data) });
  }

  // Default: enable allowlist mode, allowlist+invite admins, allowlist all pending invitees.
  const results = { restrictions: null, allowlist: [], invitations: [] };
  results.restrictions = (await clerk("/instance/restrictions", "PATCH", { allowlist: true, blocklist: false })).data;

  const pending = asList((await clerk("/invitations?status=pending&limit=100", "GET")).data).map((i) => i.email_address).filter(Boolean);
  const emails = [...new Set([...adminEmails(), ...pending.map((e) => e.toLowerCase())])];

  for (const email of emails) {
    const a = await clerk("/allowlist_identifiers", "POST", { identifier: email, notify: false });
    results.allowlist.push({ email, status: a.status });
  }
  // (Re)invite admins so they have a working ticket too.
  for (const email of adminEmails()) {
    const inv = await clerk("/invitations", "POST", { email_address: email, redirect_url: `${origin}/sign-up`, ignore_existing: true });
    results.invitations.push({ email, status: inv.status });
  }
  return Response.json({ ok: true, allowlistedEmails: emails, results });
}
