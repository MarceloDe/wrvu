// Unit suite for the redaction module. Runs in a real browser because every
// destructive step is a canvas operation — a simulated canvas would make the
// test prove something other than what ships (D20).

import {
  RedactionError,
  assertGeometryOnly,
  assertNoUnredactedImages,
  redactImage,
  redactImageBlock,
  resolveRegions,
} from "../../lib/redact/imageRedactor";
import {
  ASPECT_TOLERANCE,
  REDACTION_PROFILE_VERSION,
  REDACTION_SURFACES,
  buildRedactedImageBlock,
  buildRedactionProfile,
  decodeImageFile,
  profileBlockMessage,
  profileStatus,
  redactionProfileKey,
} from "../../lib/redact/captureRedaction";

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function assert(condition, message) {
  if (!condition) throw new Error(message || "assertion failed");
}
function assertEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message || "not equal"}: got ${a}, expected ${e}`);
}
function assertThrows(fn, code) {
  try {
    fn();
  } catch (err) {
    if (code && err.code !== code) throw new Error(`expected code ${code}, got ${err.code} (${err.message})`);
    return err;
  }
  throw new Error(`expected a throw${code ? ` with code ${code}` : ""}`);
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

async function blobToImageData(blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
}

const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

/* ----------------------------- geometry ----------------------------- */

test("resolveRegions converts 0..1 fractions to clamped pixel rectangles", () => {
  const rects = resolveRegions([{ id: "name", x: 0.5, y: 0.5, w: 0.75, h: 0.75 }], 100, 200);
  assertEqual(rects, [{ id: "name", x: 50, y: 100, w: 50, h: 100 }], "clamped to the image");
});

test("resolveRegions drops rectangles that fall entirely off the image", () => {
  assertEqual(resolveRegions([{ id: "mrn", x: 1, y: 0, w: 0.5, h: 0.5 }], 10, 10), []);
});

test("resolveRegions never rounds a sliver away to nothing", () => {
  // A one-pixel column still gets masked; rounding is outward, never inward.
  assertEqual(resolveRegions([{ id: "mrn", x: 0.95, y: 0, w: 0.01, h: 1 }], 100, 10), [{ id: "mrn", x: 95, y: 0, w: 1, h: 10 }]);
});

test("assertGeometryOnly accepts pure geometry", () => {
  assertGeometryOnly(FULL_REGIONS);
});

test("assertGeometryOnly rejects a region carrying extracted text", () => {
  assertThrows(() => assertGeometryOnly([{ id: "name", x: 0, y: 0, w: 1, h: 1, text: "QUELLINGTON, ZARA" }]), "profile-not-geometry");
});

test("assertGeometryOnly rejects an unknown region id", () => {
  assertThrows(() => assertGeometryOnly([{ id: "accession", x: 0, y: 0, w: 1, h: 1 }]), "profile-not-geometry");
});

test("assertGeometryOnly rejects out-of-range or non-finite geometry", () => {
  assertThrows(() => assertGeometryOnly([{ id: "name", x: -0.1, y: 0, w: 1, h: 1 }]), "profile-invalid");
  assertThrows(() => assertGeometryOnly([{ id: "name", x: 0, y: 0, w: 0, h: 1 }]), "profile-invalid");
  assertThrows(() => assertGeometryOnly([{ id: "name", x: 0, y: 0, w: NaN, h: 1 }]), "profile-invalid");
  assertThrows(() => assertGeometryOnly("not-an-array"), "profile-invalid");
});

/* ------------------------------ profile ----------------------------- */

test("redactionProfileKey is keyed on surface and institution (user comes from /api/store auth)", () => {
  assert(redactionProfileKey(REDACTION_SURFACES.WORKLIST, "UM").includes("worklist"));
  assert(redactionProfileKey(REDACTION_SURFACES.WORKLIST, "UM").includes("UM"));
  assert(redactionProfileKey(REDACTION_SURFACES.WORKLIST, "UM") !== redactionProfileKey(REDACTION_SURFACES.WORKLIST, "JHS"));
  assert(redactionProfileKey(REDACTION_SURFACES.REPORT, "UM") !== redactionProfileKey(REDACTION_SURFACES.WORKLIST, "UM"));
});

test("buildRedactionProfile stores geometry only", () => {
  const profile = buildRedactionProfile({ surface: "worklist", institution: "UM", regions: FULL_REGIONS, aspect: 1.5 });
  assertEqual(profile.version, REDACTION_PROFILE_VERSION);
  for (const region of profile.regions) {
    assertEqual(Object.keys(region).sort(), ["h", "id", "w", "x", "y"], "only geometry keys");
  }
});

test("buildRedactionProfile refuses a profile that is missing a required column", () => {
  assertThrows(
    () => buildRedactionProfile({ surface: "worklist", institution: "UM", regions: [FULL_REGIONS[0]], aspect: 1.5 }),
    "profile-incomplete",
  );
});

// N60 — a capture that FOLLOWS the instruction had no way through.
//
// Onboarding tells the physician to photograph the procedure, site and date columns
// only, never patient names or MRNs. A worklist captured that way has no name column
// and no MRN column to mark, and the gate demanded both — leaving "Save & redact"
// permanently disabled with no way forward. Following the instruction exactly made the
// upload impossible. Found by uploading a real PHI-free worklist on production.
test("an image with no patient columns uploads once the user says so", () => {
  const bmp = makeImageData(40, 20);
  // No attestation: still refused. The hand-construction bypass stays closed.
  assertThrows(() => redactImageBlock(bmp, []), "profile-incomplete");

  const block = redactImageBlock(bmp, [], { noPatientColumns: true });
  assertEqual(block.type, "image");
  // Clears the upload gate: the same check callClaude runs before the fetch.
  assertNoUnredactedImages([{ role: "user", content: [block] }]);
});

test("an attested capture may not also carry mask regions", () => {
  // "There are no patient columns" plus a box over one is contradictory input.
  // Refusing is honest; silently ignoring either half would not be.
  assertThrows(
    () => redactImageBlock(makeImageData(40, 20), [FULL_REGIONS[0]], { noPatientColumns: true }),
    "profile-incomplete",
  );
});

test("the attestation lives on the profile and inherits the staleness check", () => {
  const profile = buildRedactionProfile({
    surface: "worklist", institution: "UM", regions: [], aspect: 1.5, noPatientColumns: true,
  });
  assertEqual(profile.noPatientColumns, true);
  assertEqual(profile.regions, []);
  assertEqual(profileStatus(profile, { aspect: 1.5 }), { ok: true });
  // A differently shaped screenshot re-prompts rather than inheriting somebody's
  // earlier statement about a different layout.
  assertEqual(profileStatus(profile, { aspect: 2.4 }), { ok: false, reason: "stale-geometry" });
});

test("a profile with no regions and no attestation still blocks", () => {
  const profile = buildRedactionProfile({
    surface: "worklist", institution: "UM", regions: FULL_REGIONS, aspect: 1.5,
  });
  assertEqual(profileStatus({ ...profile, regions: [] }, { aspect: 1.5 }), { ok: false, reason: "incomplete" });
});

test("profileStatus: a missing profile blocks", () => {
  assertEqual(profileStatus(null, { aspect: 1.5 }), { ok: false, reason: "missing" });
});

test("profileStatus: an old profile version blocks", () => {
  const profile = buildRedactionProfile({ surface: "worklist", institution: "UM", regions: FULL_REGIONS, aspect: 1.5 });
  assertEqual(profileStatus({ ...profile, version: 0 }, { aspect: 1.5 }), { ok: false, reason: "version" });
});

test("profileStatus: an incomplete profile blocks", () => {
  const profile = buildRedactionProfile({ surface: "worklist", institution: "UM", regions: FULL_REGIONS, aspect: 1.5 });
  assertEqual(profileStatus({ ...profile, regions: [FULL_REGIONS[0]] }, { aspect: 1.5 }), { ok: false, reason: "incomplete" });
});

test("profileStatus: a profile polluted with text blocks", () => {
  const profile = buildRedactionProfile({ surface: "worklist", institution: "UM", regions: FULL_REGIONS, aspect: 1.5 });
  assertEqual(
    profileStatus({ ...profile, regions: [{ ...FULL_REGIONS[0], text: "MRN 88144021" }, FULL_REGIONS[1]] }, { aspect: 1.5 }),
    { ok: false, reason: "invalid" },
  );
});

test("profileStatus: a differently shaped screenshot is stale", () => {
  const profile = buildRedactionProfile({ surface: "worklist", institution: "UM", regions: FULL_REGIONS, aspect: 1.5 });
  assertEqual(profileStatus(profile, { aspect: 0.64 }), { ok: false, reason: "stale-geometry" });
  assertEqual(profileStatus(profile, { aspect: 1.5 * (1 + ASPECT_TOLERANCE / 2) }), { ok: true });
});

test("every block reason produces a message that names the fix", () => {
  for (const reason of ["missing", "version", "incomplete", "invalid", "stale-geometry", "unknown-geometry"]) {
    const message = profileBlockMessage(reason, "UM");
    assert(typeof message === "string" && message.length > 20, `empty message for ${reason}`);
  }
});

/* ---------------------------- redaction ----------------------------- */

test("redactImage returns an encoded Blob, not an overlay", async () => {
  const source = makeImageData(120, 80);
  const blob = redactImage(source, FULL_REGIONS);
  assert(blob instanceof Blob, "returns a Blob");
  assertEqual(blob.type, "image/jpeg");
  assert(blob.size > 0, "non-empty");
  const decoded = await blobToImageData(blob);
  assertEqual([decoded.width, decoded.height], [120, 80], "dimensions preserved");
});

test("redactImage destroys the masked pixels and keeps the rest", async () => {
  const source = makeImageData(200, 100);
  // Paint a bright block inside the name region and one outside it.
  const paint = (x, y, w, h, colour) => {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        const i = (yy * 200 + xx) * 4;
        source.data[i] = colour[0];
        source.data[i + 1] = colour[1];
        source.data[i + 2] = colour[2];
      }
    }
  };
  paint(22, 12, 30, 30, [255, 0, 0]); // inside region "name" (x .1-.3, y .1-.6)
  paint(160, 12, 30, 30, [0, 200, 0]); // outside every region
  const decoded = await blobToImageData(redactImage(source, FULL_REGIONS, { mediaType: "image/png" }));
  const inside = (25 * 200 + 30) * 4;
  const outside = (25 * 200 + 170) * 4;
  assert(lum(decoded.data, inside) < 4, `masked pixel not black: ${lum(decoded.data, inside)}`);
  assert(lum(decoded.data, outside) > 60, `unmasked pixel was destroyed: ${lum(decoded.data, outside)}`);
});

test("redactImage does not mutate the caller's bitmap", () => {
  const source = makeImageData(60, 60, [10, 20, 30, 255]);
  const before = Array.from(source.data.slice(0, 8));
  redactImage(source, FULL_REGIONS);
  assertEqual(Array.from(source.data.slice(0, 8)), before, "input buffer untouched");
});

test("redactImage rejects a profile that is not geometry", () => {
  const source = makeImageData(40, 40);
  assertThrows(() => redactImage(source, [{ id: "name", x: 0, y: 0, w: 1, h: 1, mrn: "88144021" }]), "profile-not-geometry");
});

/* --------------------------- network gate --------------------------- */

test("assertNoUnredactedImages passes text-only messages", () => {
  assertNoUnredactedImages([{ role: "user", content: "hello" }, { role: "user", content: [{ type: "text", text: "hi" }] }]);
});

test("assertNoUnredactedImages accepts a block produced by redactImageBlock", () => {
  const block = redactImageBlock(makeImageData(40, 40), FULL_REGIONS);
  assertNoUnredactedImages([{ role: "user", content: [block, { type: "text", text: "go" }] }]);
});

test("assertNoUnredactedImages refuses a hand-built image block", () => {
  assertThrows(
    () => assertNoUnredactedImages([{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }] }]),
    "unredacted-image",
  );
});

test("a redacted block that was copied is still recognised by its bytes", () => {
  const block = redactImageBlock(makeImageData(40, 40, [200, 10, 10, 255]), FULL_REGIONS);
  const copy = JSON.parse(JSON.stringify(block)); // loses object identity, keeps the bytes
  assertNoUnredactedImages([{ role: "user", content: [copy] }]);
});

test("a batch larger than the payload registry still clears the gate (no false block)", () => {
  // The Tracker input is `multiple`: a real batch can exceed the bounded
  // byte-level registry. Every block in it must still be provably redacted,
  // otherwise the guard would block an upload that WAS redacted.
  const blocks = [];
  for (let i = 0; i < 80; i++) {
    const source = makeImageData(16, 16, [i % 256, 40, 90, 255]);
    blocks.push(redactImageBlock(source, FULL_REGIONS, { mediaType: "image/png" }));
  }
  const unique = new Set(blocks.map((b) => b.source.data));
  assert(unique.size > 64, `expected >64 distinct payloads, got ${unique.size}`);
  assertNoUnredactedImages([{ role: "user", content: [...blocks, { type: "text", text: "go" }] }]);
});

test("assertNoUnredactedImages refuses an image smuggled inside a document block", () => {
  assertThrows(
    () => assertNoUnredactedImages([{ role: "user", content: [{ type: "document", source: { type: "base64", media_type: "image/png", data: "AAAA" } }] }]),
    "unredacted-image",
  );
});

/* --------------------------- capture path --------------------------- */

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

test("buildRedactedImageBlock blocks when no profile exists", async () => {
  const file = await fixtureFile();
  let error = null;
  try {
    await buildRedactedImageBlock(file, null);
  } catch (err) {
    error = err;
  }
  assert(error instanceof RedactionError, "throws a RedactionError");
  assertEqual(error.code, "redaction-profile-required");
  assertEqual(error.reason, "missing");
});

test("buildRedactedImageBlock blocks when the profile is stale for this screenshot", async () => {
  const file = await fixtureFile(200, 100); // aspect 2.0
  const profile = buildRedactionProfile({ surface: "worklist", institution: "UM", regions: FULL_REGIONS, aspect: 0.7 });
  let error = null;
  try {
    await buildRedactedImageBlock(file, profile);
  } catch (err) {
    error = err;
  }
  assertEqual(error && error.reason, "stale-geometry");
});

test("buildRedactedImageBlock produces a redacted block that clears the gate", async () => {
  const file = await fixtureFile(200, 100);
  const profile = buildRedactionProfile({ surface: "worklist", institution: "UM", regions: FULL_REGIONS, aspect: 2 });
  const block = await buildRedactedImageBlock(file, profile);
  assertEqual(block.type, "image");
  assertEqual(block.source.media_type, "image/jpeg");
  assertNoUnredactedImages([{ role: "user", content: [block] }]);
  const decoded = await blobToImageData(await (await fetch(`data:image/jpeg;base64,${block.source.data}`)).blob());
  const i = (25 * decoded.width + 30) * 4;
  assert(lum(decoded.data, i) < 20, `text pixel survived at luminance ${lum(decoded.data, i)}`);
});

test("decodeImageFile refuses a file the browser cannot decode instead of passing it through", async () => {
  const file = new File([new Uint8Array([1, 2, 3, 4])], "photo.heic", { type: "image/heic" });
  let error = null;
  try {
    await decodeImageFile(file);
  } catch (err) {
    error = err;
  }
  assert(error instanceof RedactionError, "throws rather than returning the raw file");
  assertEqual(error.code, "unsupported-format");
});

window.__runRedactionTests = async () => {
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
