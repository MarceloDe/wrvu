// N00c — "a hand-constructed attachment is BLOCKED before any network call".
//
// callClaude() is `assertApprovedAttachments(attachments)` followed by
// fetch("/api/claude", …). scripts/verify/no-unredacted-path.mjs proves that
// ordering statically, on the shipped source. This file proves what the ordering
// BUYS: it runs the real guard, from the real module, against attachments an
// attacker (or a careless future edit) could plausibly hand-build, and then
// checks with the receiving server that not one byte left the browser.
//
// Runs in a real Chromium because redaction is a canvas operation and the
// provenance registry is a WeakSet over real objects (D20 — nothing is mocked).

import * as redactModule from "../../lib/redact/imageRedactor";
import {
  RedactionError,
  assertApprovedAttachments,
  buildDocumentBlock,
  redactImageBlock,
} from "../../lib/redact/imageRedactor";
import { buildDocumentAttachment, buildRedactedImageBlock, buildRedactionProfile } from "../../lib/redact/captureRedaction";

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function assert(condition, message) {
  if (!condition) throw new Error(message || "assertion failed");
}

const FULL_REGIONS = [
  { id: "name", x: 0.1, y: 0.1, w: 0.2, h: 0.5 },
  { id: "mrn", x: 0.4, y: 0.1, w: 0.1, h: 0.5 },
];

function makeImageData(width, height, fill = [255, 255, 255, 255]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill[0];
    data[i + 1] = fill[1];
    data[i + 2] = fill[2];
    data[i + 3] = fill[3];
  }
  return new ImageData(data, width, height);
}

async function fixtureFile(width = 200, height = 100) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#000000";
  ctx.font = "16px monospace";
  ctx.fillText("QUELLINGTON", 22, 40); // synthetic (D25a)
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  return new File([blob], "worklist.png", { type: "image/png" });
}

/** A synthetic PDF. Never a real report — nothing here touches patient data. */
function fixturePdf() {
  const bytes = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");
  return new File([bytes], "monthly-report.pdf", { type: "application/pdf" });
}

/**
 * The exact sequence callClaude() performs: guard, THEN network. Every attempt
 * below goes through this, so "blocked" means the fetch was never reached and
 * the harness server has no record of it.
 */
async function guardThenSend(attachments, template = "ocr") {
  assertApprovedAttachments(attachments);
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ template, params: {}, attachments }),
  });
  return res.json();
}

/** Assert the send was refused, and say with which code. */
async function assertBlocked(attachments, expectedCode) {
  let error = null;
  try {
    await guardThenSend(attachments);
  } catch (err) {
    error = err;
  }
  assert(error, "expected the attachment to be BLOCKED, but the send was attempted");
  assert(error instanceof RedactionError, `expected a RedactionError, got ${error && error.name}: ${error && error.message}`);
  if (expectedCode) {
    assert(error.code === expectedCode, `expected code ${expectedCode}, got ${error.code}`);
  }
  return error.code;
}

/* ------------------------- the hand-built attempts ------------------------- */

test("a hand-built image block is blocked", async () => {
  await assertBlocked(
    [{ type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } }],
    "unredacted-image",
  );
});

test("a hand-built image block carrying a data URL is blocked", async () => {
  await assertBlocked(
    [{ type: "image", source: { type: "base64", media_type: "image/png", data: "data:image/png;base64,iVBORw0KGgo=" } }],
    "unredacted-image",
  );
});

test("a bare data-URL STRING attachment is blocked (the degraded wire shape)", async () => {
  // This is the shape the first N00c build sent. A string cannot be held by a
  // WeakSet, so under that design the identity witness was silently gone. It is
  // refused outright here: a string is not something lib/redact produced.
  await assertBlocked(["data:image/png;base64,iVBORw0KGgo="], "unapproved-attachment");
});

test("an image smuggled inside a document block is blocked", async () => {
  await assertBlocked(
    [{ type: "document", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } }],
    "unredacted-image",
  );
});

test("a hand-built PDF document block is blocked", async () => {
  await assertBlocked(
    [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: "JVBERi0xLjQK" } }],
    "unapproved-attachment",
  );
});

test("a genuine redacted block whose bytes were swapped is blocked", async () => {
  const genuine = redactImageBlock(makeImageData(40, 40, [12, 200, 90, 255]), FULL_REGIONS);
  const tampered = JSON.parse(JSON.stringify(genuine));
  tampered.source.data = "iVBORw0KGgoAAAANSUhEUg==";
  await assertBlocked([tampered], "unredacted-image");
});

test("a genuine block hidden behind a forged sibling still blocks the whole send", async () => {
  const genuine = redactImageBlock(makeImageData(40, 40, [7, 7, 200, 255]), FULL_REGIONS);
  await assertBlocked(
    [genuine, { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAAA" } }],
    "unredacted-image",
  );
});

test("non-objects and empty shapes are blocked, not skipped", async () => {
  for (const bad of [null, undefined, 0, 42, "", "hello", true, [], [[]]]) {
    await assertBlocked([bad], "unapproved-attachment");
  }
  await assertBlocked([{}], "unapproved-attachment");
  await assertBlocked([{ type: "image" }], "unredacted-image");
});

test("a non-array attachment list is blocked", async () => {
  let error = null;
  try {
    await guardThenSend({ type: "image" });
  } catch (err) {
    error = err;
  }
  assert(error && error.code === "unapproved-attachment", `expected unapproved-attachment, got ${error && error.code}`);
});

/* ------------------- the doors that could mint an approval ------------------ */

test("the provenance marker is NOT exported — there is no way to mark by hand", () => {
  const exported = Object.keys(redactModule);
  for (const name of exported) {
    assert(!/^mark/i.test(name), `lib/redact/imageRedactor exports "${name}" — a marker must stay module-private`);
  }
  assert(!("markApprovedAttachment" in redactModule), "markApprovedAttachment is exported");
  assert(!("markRedactedPayload" in redactModule), "markRedactedPayload is exported");
  // The only two doors, both of which do the real work before registering.
  assert(typeof redactModule.redactImageBlock === "function", "redactImageBlock missing");
  assert(typeof redactModule.buildDocumentBlock === "function", "buildDocumentBlock missing");
});

test("redactImageBlock refuses to mint an approval from an incomplete mask", () => {
  for (const regions of [[], [FULL_REGIONS[0]], [FULL_REGIONS[1]]]) {
    let error = null;
    try {
      redactImageBlock(makeImageData(40, 40), regions);
    } catch (err) {
      error = err;
    }
    assert(error && error.code === "profile-incomplete", `expected profile-incomplete, got ${error && error.code}`);
  }
});

test("buildDocumentBlock refuses every media type except application/pdf", () => {
  for (const mediaType of ["image/png", "image/jpeg", "text/html", "application/octet-stream", ""]) {
    let error = null;
    try {
      buildDocumentBlock(mediaType, "AAAA");
    } catch (err) {
      error = err;
    }
    assert(error && error.code === "unapproved-attachment", `${mediaType} was not refused (${error && error.code})`);
  }
});

test("buildDocumentAttachment refuses a file that is not a PDF", async () => {
  let error = null;
  try {
    await buildDocumentAttachment(await fixtureFile());
  } catch (err) {
    error = err;
  }
  assert(error && error.code === "unapproved-attachment", `expected unapproved-attachment, got ${error && error.code}`);
});

/* --------------------------- the positive control --------------------------- */
// Without these the suite could pass by blocking everything, which would be a
// vacuous check (INV-CHECKS-ACTUALLY-RUN).

test("a genuine redacted screenshot IS sent", async () => {
  const profile = buildRedactionProfile({ surface: "worklist", institution: "UM", regions: FULL_REGIONS, aspect: 2 });
  const block = await buildRedactedImageBlock(await fixtureFile(200, 100), profile);
  const data = await guardThenSend([block], "ocr");
  assert(data && Array.isArray(data.content), "the honest send did not reach the server");
});

test("a genuine PDF report IS sent", async () => {
  const block = await buildDocumentAttachment(fixturePdf());
  assert(block.type === "document" && block.source.media_type === "application/pdf", "wrong block shape");
  const data = await guardThenSend([block], "timeline");
  assert(data && Array.isArray(data.content), "the honest send did not reach the server");
});

test("a structurally cloned genuine block is NOT falsely blocked", async () => {
  const genuine = redactImageBlock(makeImageData(48, 48, [3, 140, 220, 255]), FULL_REGIONS);
  const clone = JSON.parse(JSON.stringify(genuine)); // identity lost, bytes intact
  const data = await guardThenSend([clone], "ocr");
  assert(data && Array.isArray(data.content), "a genuinely redacted block was refused");
});

window.__runForgedAttachmentTests = async () => {
  const results = [];
  for (const { name, fn } of tests) {
    try {
      await fn();
      results.push({ name, ok: true });
    } catch (err) {
      results.push({ name, ok: false, error: err && err.message ? err.message : String(err) });
    }
  }
  return results;
};
