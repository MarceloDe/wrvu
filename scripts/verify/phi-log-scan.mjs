#!/usr/bin/env node
/**
 * INV-NO-PHI-IN-CLOUD log check.
 *
 *   node scripts/verify/phi-log-scan.mjs --stream captured-session.log
 *
 * Scans a captured session (console output + request/response lines) for
 * anything patient-shaped: the synthetic fixture's identifiers, MRN/DOB/SSN
 * patterns, patient-name fields, and inlined base64 image payloads.
 *
 * A missing stream is a FAILURE, not a pass — an unscanned log proves nothing.
 * Matches are reported by pattern, line and column; the matched text itself is
 * never echoed, because echoing it would put it in another log.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const SPEC = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures", "synthetic-identifiers.json"), "utf8"));

const streams = [];
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === "--stream") streams.push(process.argv[++i]);
  else if (process.argv[i].startsWith("--stream=")) streams.push(process.argv[i].slice("--stream=".length));
}
if (!streams.length) {
  console.error("phi-log-scan: usage: --stream <file> [--stream <file> ...]");
  process.exit(1);
}

const PATTERNS = [
  { id: "mrn-value", re: /\bMRN\b\s*[:#]?\s*\d{4,}/gi },
  { id: "medical-record-number", re: /\bmedical[_\s-]?record[_\s-]?(number|no|#)\b/gi },
  { id: "dob", re: /\b(dob|date[_\s-]?of[_\s-]?birth)\b\s*[:=]/gi },
  { id: "ssn", re: /\b\d{3}-\d{2}-\d{4}\b/g },
  { id: "patient-name-field", re: /["']?\bpatient[_\s-]?name\b["']?\s*[:=]/gi },
  { id: "inline-image-payload", re: /data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]{512,}/gi },
  { id: "base64-image-block", re: /"media_type"\s*:\s*"image\/[a-z+]+"\s*,\s*"data"\s*:\s*"[A-Za-z0-9+/=]{512,}"/gi },
];

const fixtureIdentifiers = [];
for (const row of SPEC.rows) {
  fixtureIdentifiers.push({ id: "synthetic-patient-name", value: row.name });
  fixtureIdentifiers.push({ id: "synthetic-mrn", value: row.mrn });
  fixtureIdentifiers.push({ id: "synthetic-mrn-digits", value: row.mrn.replace(/\D/g, "") });
}

const findings = [];
let scannedLines = 0;

for (const stream of streams) {
  const abs = path.isAbsolute(stream) ? stream : path.join(ROOT, stream);
  if (!fs.existsSync(abs)) {
    console.error(`phi-log-scan: stream not found: ${stream} (an unscanned log is a failure, not a pass)`);
    process.exit(1);
  }
  const text = fs.readFileSync(abs, "utf8");
  if (!text.trim()) {
    console.error(`phi-log-scan: stream is empty: ${stream}`);
    process.exit(1);
  }
  const lines = text.split(/\r?\n/);
  scannedLines += lines.length;
  lines.forEach((line, index) => {
    for (const pattern of PATTERNS) {
      pattern.re.lastIndex = 0;
      let match;
      while ((match = pattern.re.exec(line)) !== null) {
        findings.push({ stream, line: index + 1, column: match.index + 1, pattern: pattern.id, length: match[0].length });
        if (match[0].length === 0) pattern.re.lastIndex++;
      }
    }
    for (const identifier of fixtureIdentifiers) {
      const at = line.indexOf(identifier.value);
      if (at !== -1) findings.push({ stream, line: index + 1, column: at + 1, pattern: identifier.id, length: identifier.value.length });
    }
  });
}

console.log(`phi-log-scan: scanned ${scannedLines} line(s) across ${streams.length} stream(s) for ${PATTERNS.length} PHI patterns + ${fixtureIdentifiers.length} synthetic fixture identifiers`);
if (!findings.length) {
  console.log("  ok   no patient-shaped value found");
  process.exit(0);
}
for (const finding of findings) {
  console.error(`  FAIL ${finding.stream}:${finding.line}:${finding.column} matched ${finding.pattern} (${finding.length} chars, value withheld)`);
}
process.exit(1);
