#!/usr/bin/env node
// Assert a red PR reports BLOCKED and an API merge attempt fails.
import { pass, fail, pending, has } from "./_lib.mjs";

const DEP = ".github/workflows/ci.yml";
if (DEP.startsWith(".env.local:")) {
  const v = DEP.split(":")[1];
  if (!process.env[v]) pending(`${v} is not in the environment, so this check cannot contact the live service`, "N03 lands CI and branch protection");
} else if (!has(DEP)) {
  pending(`${DEP} does not exist, so there is nothing to verify`, "N03 lands CI and branch protection");
}
fail("merge-blocked: dependency present but the check body is not implemented yet — refusing to report a pass it did not earn");
