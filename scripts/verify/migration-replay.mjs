#!/usr/bin/env node
// Apply the migration set to an EMPTY Neon branch and diff the result.
import { pass, fail, pending, has } from "./_lib.mjs";

const DEP = "lib/db/migrate.mjs";
if (DEP.startsWith(".env.local:")) {
  const v = DEP.split(":")[1];
  if (!process.env[v]) pending(`${v} is not in the environment, so this check cannot contact the live service`, "N02 lands the migrator");
} else if (!has(DEP)) {
  pending(`${DEP} does not exist, so there is nothing to verify`, "N02 lands the migrator");
}
fail("migration-replay: dependency present but the check body is not implemented yet — refusing to report a pass it did not earn");
