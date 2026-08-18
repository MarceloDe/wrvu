#!/usr/bin/env node
// Assert Clerk refuses a known-breached password at user creation.
import { pass, fail, pending, has } from "./_lib.mjs";

const DEP = ".env.local:CLERK_SECRET_KEY";
if (DEP.startsWith(".env.local:")) {
  const v = DEP.split(":")[1];
  if (!process.env[v]) pending(`${v} is not in the environment, so this check cannot contact the live service`, "the operator supplies Clerk keys locally");
} else if (!has(DEP)) {
  pending(`${DEP} does not exist, so there is nothing to verify`, "the operator supplies Clerk keys locally");
}
fail("weak-password-rejected: dependency present but the check body is not implemented yet — refusing to report a pass it did not earn");
