#!/usr/bin/env node
// Local operator CLI for the Clerk Backend API.
//
// Replaces the deleted, token-gated /api/setup-clerk route (node
// N00a-remove-token-gated-routes). Clerk root operations do not belong in a
// request handler: this runs on the operator's own machine, reads
// CLERK_SECRET_KEY from the local environment, and refuses to run inside a
// deployed context. Every invocation appends to goals/evidence/ops-audit.jsonl
// (INV-PROD-AUDITED).
//
// Usage:
//   node scripts/ops/clerk-admin.mjs --list-allowlist
//   node scripts/ops/clerk-admin.mjs --inspect
//   node scripts/ops/clerk-admin.mjs --user <email>
//   node scripts/ops/clerk-admin.mjs --fix-user    --email <email> --password <pw>
//   node scripts/ops/clerk-admin.mjs --create-user --email <email> --password <pw>
//   node scripts/ops/clerk-admin.mjs --enable-allowlist [--redirect-url <url>]
//
// Provide the key locally, e.g.:
//   CLERK_SECRET_KEY=sk_... node scripts/ops/clerk-admin.mjs --inspect
//   vercel env pull .env.local && node --env-file=.env.local scripts/ops/clerk-admin.mjs --inspect

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const CLERK_API = "https://api.clerk.com/v1";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const AUDIT_LOG = resolve(REPO_ROOT, "goals/evidence/ops-audit.jsonl");

// ---------------------------------------------------------------- audit log

function auditAppend(entry) {
  mkdirSync(dirname(AUDIT_LOG), { recursive: true });
  appendFileSync(AUDIT_LOG, JSON.stringify(entry) + "\n", { encoding: "utf8" });
}

// Never write a password or a key into the audit log.
function redactArgv(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    out.push(argv[i]);
    if (argv[i] === "--password") {
      out.push("<redacted>");
      i++;
    }
  }
  return out;
}

// ------------------------------------------------------------ clerk backend

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
  try {
    data = await r.json();
  } catch {
    data = null;
  }
  return { status: r.status, data };
}

const asList = (d) => (Array.isArray(d) ? d : d?.data || []);

function adminEmails() {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function must(res, what) {
  if (res.status >= 300) {
    throw new Error(`${what} failed: clerk returned ${res.status}`);
  }
  return res;
}

// ------------------------------------------------------------------ actions

async function listAllowlist() {
  const res = must(await clerk("/allowlist_identifiers?limit=100", "GET"), "list-allowlist");
  const allowlist = asList(res.data).map((a) => a.identifier);
  return { allowlist, count: allowlist.length };
}

async function inspect() {
  const [restr, inv, allow] = await Promise.all([
    clerk("/instance/restrictions", "GET"),
    clerk("/invitations?status=pending&limit=100", "GET"),
    clerk("/allowlist_identifiers?limit=100", "GET"),
  ]);
  must(restr, "restrictions");
  must(inv, "invitations");
  must(allow, "allowlist");
  return {
    restrictions: restr.data,
    invitations: asList(inv.data).map((i) => ({
      email: i.email_address,
      status: i.status,
      createdAt: i.created_at,
    })),
    allowlist: asList(allow.data).map((a) => a.identifier),
  };
}

async function diagnoseUser(rawEmail) {
  const email = String(rawEmail || "").trim().toLowerCase();
  if (!email) throw new Error("--user requires an email");
  const res = must(
    await clerk(`/users?email_address=${encodeURIComponent(email)}`, "GET"),
    "user lookup",
  );
  const u = asList(res.data)[0];
  if (!u) return { found: false, email };
  const primary =
    (u.email_addresses || []).find((e) => e.id === u.primary_email_address_id) ||
    (u.email_addresses || [])[0];
  return {
    found: true,
    id: u.id,
    email,
    banned: u.banned,
    locked: u.locked,
    lockoutExpiresInSeconds: u.lockout_expires_in_seconds,
    passwordEnabled: u.password_enabled,
    emailVerification: primary?.verification?.status || null,
    lastSignInAt: u.last_sign_in_at,
    createdAt: u.created_at,
  };
}

async function fixUser({ email: rawEmail, password }) {
  const email = String(rawEmail || "").trim().toLowerCase();
  if (!email || String(password || "").length < 8) {
    throw new Error("--fix-user requires --email and --password (>= 8 chars)");
  }
  const found = must(
    await clerk(`/users?email_address=${encodeURIComponent(email)}`, "GET"),
    "user lookup",
  );
  const u = asList(found.data)[0];
  if (!u) throw new Error(`user not found: ${email}`);

  const steps = {};
  steps.password = must(
    await clerk(`/users/${u.id}`, "PATCH", { password, skip_password_checks: true }),
    "password reset",
  ).status;
  steps.unlock = must(await clerk(`/users/${u.id}/unlock`, "POST"), "unlock").status;
  const primary =
    (u.email_addresses || []).find((e) => e.id === u.primary_email_address_id) ||
    (u.email_addresses || [])[0];
  if (primary && primary.verification?.status !== "verified") {
    steps.verifyEmail = must(
      await clerk(`/email_addresses/${primary.id}`, "PATCH", { verified: true }),
      "verify email",
    ).status;
  } else {
    steps.verifyEmail = "already";
  }
  const after = await clerk(`/users?email_address=${encodeURIComponent(email)}`, "GET");
  const u2 = asList(after.data)[0] || {};
  return {
    email,
    userId: u.id,
    steps,
    now: { locked: u2.locked, passwordEnabled: u2.password_enabled },
  };
}

async function createUser({ email: rawEmail, password }) {
  const email = String(rawEmail || "").trim().toLowerCase();
  if (!email || String(password || "").length < 8) {
    throw new Error("--create-user requires --email and --password (>= 8 chars)");
  }
  // Allowlist first so restricted mode accepts the address.
  must(
    await clerk("/allowlist_identifiers", "POST", { identifier: email, notify: false }),
    "allowlist",
  );
  const res = await clerk("/users", "POST", {
    email_address: [email],
    password,
    skip_password_checks: true,
  });
  if (res.status >= 300) {
    throw new Error(
      `create-user failed: clerk returned ${res.status}: ${res.data?.errors?.[0]?.message || ""}`,
    );
  }
  return { email, userId: res.data?.id ?? null };
}

async function enableAllowlist({ redirectUrl }) {
  const results = { restrictions: null, allowlist: [], invitations: [] };
  results.restrictions = must(
    await clerk("/instance/restrictions", "PATCH", { allowlist: true, blocklist: false }),
    "restrictions",
  ).data;

  const pending = asList(
    must(await clerk("/invitations?status=pending&limit=100", "GET"), "invitations").data,
  )
    .map((i) => i.email_address)
    .filter(Boolean)
    .map((e) => e.toLowerCase());
  const emails = [...new Set([...adminEmails(), ...pending])];

  for (const email of emails) {
    const a = await clerk("/allowlist_identifiers", "POST", { identifier: email, notify: false });
    results.allowlist.push({ email, status: a.status });
  }
  for (const email of adminEmails()) {
    const inv = await clerk("/invitations", "POST", {
      email_address: email,
      redirect_url: `${redirectUrl}/sign-up`,
      ignore_existing: true,
    });
    results.invitations.push({ email, status: inv.status });
  }
  return { allowlistedEmails: emails, results };
}

// Rollback path recorded in the audit log, per action (INV-PROD-AUDITED).
const ROLLBACK = {
  "list-allowlist": "none — read-only",
  inspect: "none — read-only",
  user: "none — read-only",
  "fix-user":
    "password change is not reversible: set a new password with --fix-user and notify the account owner; re-lock is not offered by Clerk",
  "create-user":
    "delete the user in the Clerk dashboard (Users -> delete) and remove the allowlist entry for the same address",
  "enable-allowlist":
    "PATCH /instance/restrictions {allowlist:false} in the Clerk dashboard (User & Authentication -> Restrictions) and delete any allowlist identifier added by this run",
};

// --------------------------------------------------------------- arg parsing

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }
  return flags;
}

const USAGE = `clerk-admin — local Clerk Backend API operator CLI

  --list-allowlist                      list allowlisted identifiers
  --inspect                             restrictions + pending invitations + allowlist
  --user <email>                        diagnose one account
  --fix-user    --email <e> --password <p>   reset password, clear lockout, verify email
  --create-user --email <e> --password <p>   allowlist + create a verified user
  --enable-allowlist [--redirect-url <url>]  allowlist mode on; allowlist+invite ADMIN_EMAILS
                                             and every pending invitee

Requires CLERK_SECRET_KEY in the local environment. Refuses to run in a deployed context.
Every invocation is appended to goals/evidence/ops-audit.jsonl.`;

function pickAction(flags) {
  if (flags["list-allowlist"]) return "list-allowlist";
  if (flags.inspect) return "inspect";
  if (flags.user) return "user";
  if (flags["fix-user"]) return "fix-user";
  if (flags["create-user"]) return "create-user";
  if (flags["enable-allowlist"]) return "enable-allowlist";
  return null;
}

async function run(action, flags) {
  switch (action) {
    case "list-allowlist":
      return listAllowlist();
    case "inspect":
      return inspect();
    case "user":
      return diagnoseUser(flags.user);
    case "fix-user":
      return fixUser({ email: flags.email, password: flags.password });
    case "create-user":
      return createUser({ email: flags.email, password: flags.password });
    case "enable-allowlist":
      return enableAllowlist({
        redirectUrl: String(flags["redirect-url"] || "https://fella.cc").replace(/\/+$/, ""),
      });
    default:
      throw new Error("unreachable");
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const flags = parseArgs(argv);
  const action = pickAction(flags);

  if (!action || flags.help) {
    process.stdout.write(USAGE + "\n");
    process.exit(action ? 0 : 2);
  }

  // This CLI must never run inside a deployed context — that is the whole point
  // of node N00a. Only variables the deployed runtime itself sets count as
  // evidence of one: `vercel env pull` writes VERCEL/VERCEL_ENV into the local
  // env file, so those two cannot be used as the signal.
  const deployedSignal = ["AWS_LAMBDA_FUNCTION_NAME", "VERCEL_REGION", "NOW_REGION"].find(
    (k) => process.env[k],
  );
  if (deployedSignal) {
    process.stderr.write(
      `refusing to run: deployed context detected (${deployedSignal} is set).\n` +
        "This CLI is local-only. Clerk root operations must not run in a deployed environment.\n",
    );
    process.exit(3);
  }
  if (!process.env.CLERK_SECRET_KEY) {
    process.stderr.write(
      "refusing to run: CLERK_SECRET_KEY is not set in the local environment.\n" +
        "Provide it locally, e.g. `vercel env pull .env.local` then\n" +
        "`node --env-file=.env.local scripts/ops/clerk-admin.mjs " + argv.join(" ") + "`.\n",
    );
    process.exit(4);
  }

  const started = new Date().toISOString();
  const base = {
    ts: started,
    actor: `${os.userInfo().username}@${os.hostname()}`,
    tool: "scripts/ops/clerk-admin.mjs",
    command: ["node", "scripts/ops/clerk-admin.mjs", ...redactArgv(argv)].join(" "),
    action,
    target: "clerk-backend-api",
    node: "N00a-remove-token-gated-routes",
    rollback: ROLLBACK[action],
  };

  try {
    const result = await run(action, flags);
    auditAppend({ ...base, finished: new Date().toISOString(), outcome: "ok", result });
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } catch (e) {
    auditAppend({
      ...base,
      finished: new Date().toISOString(),
      outcome: "error",
      error: String(e && e.message ? e.message : e),
    });
    process.stderr.write(`error: ${e && e.message ? e.message : e}\n`);
    process.exit(1);
  }
}

await main();
