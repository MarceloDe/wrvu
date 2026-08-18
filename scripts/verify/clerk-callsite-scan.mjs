#!/usr/bin/env node
// INV-CLERK-PHI-FREE — no PHI in Clerk metadata or any Clerk-bound payload.
import { pass, fail, walk, read, rel, ROOT } from "./_lib.mjs";
import { readFileSync } from "node:fs";

const PHI = /\b(patient|patientName|mrn|medicalRecord|accession|dob|dateOfBirth|ssn|firstName|lastName)\b/i;
const CLERK = /\b(clerkClient|publicMetadata|privateMetadata|unsafeMetadata|users\.(create|update)|updateUserMetadata)\b/;

const hits = [];
for (const f of [...walk("app"), ...walk("lib"), ...walk("components"), ...walk("scripts")]) {
  const src = readFileSync(f, "utf8");
  if (!CLERK.test(src)) continue;
  src.split("\n").forEach((line, i) => {
    if (CLERK.test(line) && PHI.test(line)) hits.push(`${rel(f)}:${i + 1}  ${line.trim().slice(0, 120)}`);
    // metadata object literals spanning lines: flag PHI within 6 lines of a metadata key
    if (/Metadata\s*[:=]\s*\{/.test(line)) {
      const win = src.split("\n").slice(i, i + 6).join("\n");
      if (PHI.test(win)) hits.push(`${rel(f)}:${i + 1}  PHI-shaped key inside a Clerk metadata literal`);
    }
  });
}
hits.length ? fail(`${hits.length} Clerk call site(s) carry PHI-shaped fields`, hits)
            : pass("no PHI-shaped field at any Clerk call site");
