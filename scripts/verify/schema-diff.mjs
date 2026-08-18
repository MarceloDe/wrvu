#!/usr/bin/env node
// Compare two schemas and report every difference. Exits 1 on any.
import { pass, fail, pending, has } from "./_lib.mjs";

const DEP = "lib/db/migrate.mjs";
if (DEP.startsWith(".env.local:")) {
  const v = DEP.split(":")[1];
  if (!process.env[v]) pending(`${v} is not in the environment, so this check cannot contact the live service`, "N02 lands the migrator and the baseline");
} else if (!has(DEP)) {
  pending(`${DEP} does not exist, so there is nothing to verify`, "N02 lands the migrator and the baseline");
}
fail("schema-diff: dependency present but the check body is not implemented yet — refusing to report a pass it did not earn");
