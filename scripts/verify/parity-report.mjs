#!/usr/bin/env node
// INV-PARITY — the Swift and TypeScript implementations agree on shared fixtures.
import { pass, fail, pending, has, walk } from "./_lib.mjs";

const FIX = "contracts/fixtures/pricing";
if (!has(FIX)) {
  pending("no shared golden fixtures exist, so there is nothing for two implementations to agree ON",
          "N14a lands contracts/fixtures/pricing/*.json");
}
if (!has("packages/core/src/pricing") && !has("lib/pricing")) {
  pending("the TypeScript pricing engine does not exist yet", "N14 lands resolveValue() in TypeScript");
}
pending("both fixture set and TS engine exist; the Swift half is compared by xcodebuild in the iOS repo and its report is not readable from here",
        "N26 lands the Swift engine and writes parity-report.json into this repo's evidence tree");
