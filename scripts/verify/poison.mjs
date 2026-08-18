#!/usr/bin/env node
// Cut a poison branch, open a PR, and assert CI goes RED at a named step.
import { pass, fail, pending, has } from "./_lib.mjs";

const DEP = ".github/workflows/ci.yml";
if (DEP.startsWith(".env.local:")) {
  const v = DEP.split(":")[1];
  if (!process.env[v]) pending(`${v} is not in the environment, so this check cannot contact the live service`, "N03 lands the CI workflow");
} else if (!has(DEP)) {
  pending(`${DEP} does not exist, so there is nothing to verify`, "N03 lands the CI workflow");
}
fail("poison: dependency present but the check body is not implemented yet — refusing to report a pass it did not earn");
