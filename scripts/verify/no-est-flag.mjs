#!/usr/bin/env node
// INV-NO-ESTIMATES — no estimate flag survives outside the status-C override table.
import { pass, fail, pending, has, walk, rel } from "./_lib.mjs";
import { readFileSync } from "node:fs";

const ingested = has("drizzle") && walk("drizzle", [".sql"]).some((f) => /code_rvus|fee_schedule/.test(readFileSync(f, "utf8")));
if (!ingested) {
  // The rule is "no estimate reaches an authoritative total". There is no authoritative
  // CMS table yet, so every wRVU is by definition provisional and the rule has no subject.
  pending("no ingested CMS fee schedule exists, so there is no authoritative total for an estimate to contaminate",
          "N11/N12 land the reference schema and the PPRRVU ingest");
}
const hits = [];
for (const f of [...walk("lib"), ...walk("components"), ...walk("app")]) {
  readFileSync(f, "utf8").split("\n").forEach((l, i) => {
    if (/\best\s*:\s*true\b/.test(l) && !/status[_ ]?c|carrier/i.test(l)) hits.push(`${rel(f)}:${i + 1}`);
  });
}
hits.length ? fail(`${hits.length} estimate flag(s) outside the status-C override lane`, hits)
            : pass("no estimate flag outside the status-C override lane");
