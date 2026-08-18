#!/usr/bin/env node
/**
 * N00f — end-to-end proof that no patient identifier leaves the browser.
 *
 * Real Chromium. The real dashboard component. A synthetic PHI worklist fixture
 * (D25a). The run:
 *
 *   1. attaches the fixture to the real capture input;
 *   2. asserts the upload is BLOCKED because no redaction profile exists yet,
 *      and that not one byte went to /api/claude;
 *   3. drags the patient-name and MRN column boxes in the real tagger and saves;
 *   4. lets the upload proceed and intercepts the outbound request body;
 *   5. decodes the image out of that body and re-OCRs it — zero fixture
 *      identifiers may be present, while the non-PHI columns must still be
 *      readable (so a blind detector cannot pass this test);
 *   6. inspects the masked pixels in the DECODED bytes (not the DOM);
 *   7. re-attaches a differently-shaped screenshot and asserts the now-stale
 *      profile blocks that upload too;
 *   8. asserts a hand-built image block is refused at the network boundary;
 *   9. asserts the persisted profile is geometry only.
 *
 * Evidence lands in goals/evidence/N00f-redact-before-upload/.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { HARNESS_HTML, buildHarnessBundle } from "./harness/bundle.mjs";
import { resolveChromium } from "./harness/chromium.mjs";
import { startHarnessServer } from "./harness/server.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const EVIDENCE = path.join(ROOT, "goals", "evidence", "N00f-redact-before-upload");
const SPEC = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures", "synthetic-identifiers.json"), "utf8"));

const CSS_SHIM = `
  #root img{display:block;width:100%;height:auto}
  .relative{position:relative}.absolute{position:absolute}
  .fixed{position:fixed}.inset-0{top:0;right:0;bottom:0;left:0}
  .max-w-3xl{max-width:48rem}.overflow-hidden{overflow:hidden}
  .hidden{display:none}
`;

const results = { node: "N00f-redact-before-upload", startedAt: new Date().toISOString(), checks: [] };
const sessionLog = [];
let failures = 0;

function check(name, ok, detail) {
  results.checks.push({ name, ok: !!ok, detail });
  if (!ok) failures += 1;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${detail ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
}

function log(line) {
  sessionLog.push(`${new Date().toISOString()} ${line}`);
}

async function main() {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const bundle = await buildHarnessBundle();
  const html = HARNESS_HTML.replace("</style>", `${CSS_SHIM}</style>`);
  const harness = await startHarnessServer({ bundle, html });
  const executablePath = resolveChromium();
  results.browser = executablePath;
  const browser = await chromium.launch({ executablePath, headless: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "n00f-"));

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    page.on("console", (msg) => log(`console.${msg.type()} ${msg.text()}`));
    page.on("pageerror", (err) => log(`pageerror ${err.message}`));
    page.on("request", (req) => log(`request ${req.method()} ${req.url()} bytes=${(req.postData() || "").length}`));
    page.on("response", (res) => log(`response ${res.status()} ${res.url()}`));

    await page.goto(`${harness.origin}/`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => !!window.__redact, null, { timeout: 20000 });
    await page.waitForSelector("#shot", { state: "attached", timeout: 20000 });

    /* ---- fixture (synthetic PHI, drawn in-browser) ---- */
    const fixtures = await page.evaluate(() => {
      const { drawSyntheticWorklist, spec } = window.__redact;
      return {
        landscape: drawSyntheticWorklist(spec).toDataURL("image/png"),
        portrait: drawSyntheticWorklist(spec, { transpose: true }).toDataURL("image/png"),
      };
    });
    const fixturePath = path.join(tmp, "synthetic-worklist.png");
    const portraitPath = path.join(tmp, "synthetic-worklist-portrait.png");
    fs.writeFileSync(fixturePath, Buffer.from(fixtures.landscape.split(",")[1], "base64"));
    fs.writeFileSync(portraitPath, Buffer.from(fixtures.portrait.split(",")[1], "base64"));
    fs.copyFileSync(fixturePath, path.join(EVIDENCE, "fixture-synthetic-worklist.png"));

    /* ---- 1. first upload is blocked: no profile yet ---- */
    await page.setInputFiles("#shot", fixturePath);
    await page.waitForSelector('[data-testid="redaction-frame"]', { timeout: 20000 });
    check("upload blocked until the patient-name and MRN columns are marked", harness.state.claudeRequests.length === 0, {
      claudeRequests: harness.state.claudeRequests.length,
    });
    const blockedMessage = await page.evaluate(() => document.body.innerText.includes("mark the patient-name and MRN columns"));
    check("the block is surfaced to the user, not swallowed", blockedMessage);

    /* ---- 2. mark the two columns in the real tagger ---- */
    const frame = await page.locator('[data-testid="redaction-frame"]').boundingBox();
    const drag = async (region) => {
      const x0 = frame.x + region.x * frame.width;
      const y0 = frame.y + region.y * frame.height;
      const x1 = frame.x + (region.x + region.w) * frame.width;
      const y1 = frame.y + (region.y + region.h) * frame.height;
      await page.mouse.move(x0, y0);
      await page.mouse.down();
      await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 6 });
      await page.mouse.move(x1, y1, { steps: 6 });
      await page.mouse.up();
    };
    await drag(SPEC.regions.name);
    await drag(SPEC.regions.mrn);
    check("both column regions were captured by the tagger", (await page.locator('[data-testid^="region-"]').count()) >= 2);
    await page.locator('[data-testid="redaction-save"]').click();

    /* ---- 3. the upload now proceeds; capture the outbound body ---- */
    await page.waitForFunction(() => !document.querySelector('[data-testid="redaction-frame"]'), null, { timeout: 20000 });
    const deadline = Date.now() + 30000;
    while (harness.state.claudeRequests.length === 0 && Date.now() < deadline) {
      await page.waitForTimeout(150);
    }
    check("the upload proceeds once the profile exists", harness.state.claudeRequests.length === 1, {
      claudeRequests: harness.state.claudeRequests.length,
    });
    if (!harness.state.claudeRequests.length) throw new Error("no outbound /api/claude request was captured");

    // N00c: the wire is { template, params, attachments }. The prompt is no
    // longer in the body at all — it is resolved server-side from the registry.
    const outbound = JSON.parse(harness.state.claudeRequests[0].raw);
    const blocks = Array.isArray(outbound.attachments) ? outbound.attachments : [];
    check("the outbound body names a server template and carries no prompt", outbound.template === "ocr" && !("system" in outbound) && !("messages" in outbound), {
      keys: Object.keys(outbound).sort().join(","),
      template: outbound.template,
    });
    const imageBlocks = blocks.filter((b) => b && b.type === "image");
    check("the outbound body carries exactly one image block", imageBlocks.length === 1, { imageBlocks: imageBlocks.length });
    const outboundBase64 = imageBlocks[0]?.source?.data || "";
    const outboundMedia = imageBlocks[0]?.source?.media_type || "";
    fs.writeFileSync(path.join(EVIDENCE, "outbound-image.jpg"), Buffer.from(outboundBase64, "base64"));
    check("the outbound bytes are not the original screenshot", outboundBase64 !== fixtures.landscape.split(",")[1], {
      outboundBytes: Buffer.from(outboundBase64, "base64").length,
      originalBytes: Buffer.from(fixtures.landscape.split(",")[1], "base64").length,
      mediaType: outboundMedia,
    });

    /* ---- 4. decode, OCR and pixel-inspect the intercepted image ---- */
    const analysis = await page.evaluate(async ({ outboundDataUrl, fixtureDataUrl, regions }) => {
      const R = window.__redact;
      const font = R.spec.layout.font;
      const fixtureData = await R.dataUrlToImageData(fixtureDataUrl);
      // Positive control: the SAME encoder, the SAME image, zero regions.
      const controlBlob = R.redactImage(fixtureData, []);
      const controlBitmap = await createImageBitmap(controlBlob);
      const controlCanvas = document.createElement("canvas");
      controlCanvas.width = controlBitmap.width;
      controlCanvas.height = controlBitmap.height;
      controlCanvas.getContext("2d").drawImage(controlBitmap, 0, 0);
      const controlData = R.canvasToImageData(controlCanvas);
      const controlDataUrl = controlCanvas.toDataURL("image/jpeg", 0.85);

      const outboundData = await R.dataUrlToImageData(outboundDataUrl);

      const phi = [];
      for (const row of R.spec.rows) {
        phi.push(row.name, row.mrn);
      }
      const nonPhi = [R.spec.rows[0].site, R.spec.rows[0].procedure, R.spec.rows[0].date, "PROCEDURE", "EXAM DATE"];

      const templates = new Map();
      const tpl = (text) => {
        if (!templates.has(text)) templates.set(text, R.renderTemplate(text, font));
        return templates.get(text);
      };

      const controlHits = phi.map((text) => R.findTemplate(controlData, tpl(text), text));
      const outboundPhi = phi.map((text) => R.findTemplate(outboundData, tpl(text), text));
      const outboundNonPhi = nonPhi.map((text) => R.findTemplate(outboundData, tpl(text), text));

      // Pixel inspection of the masked rectangles in the DECODED outbound bytes.
      const rects = R.resolveRegions(
        Object.entries(regions).map(([id, r]) => ({ id, ...r })),
        outboundData.width,
        outboundData.height,
      );
      const pixelChecks = rects.map((rect) => {
        let maxLum = 0;
        let nonBlack = 0;
        let sumLum = 0;
        for (let y = rect.y; y < rect.y + rect.h; y++) {
          for (let x = rect.x; x < rect.x + rect.w; x++) {
            const i = (y * outboundData.width + x) * 4;
            const lum = 0.299 * outboundData.data[i] + 0.587 * outboundData.data[i + 1] + 0.114 * outboundData.data[i + 2];
            if (lum > maxLum) maxLum = lum;
            sumLum += lum;
            if (lum > 24) nonBlack += 1;
          }
        }
        return { id: rect.id, rect, maxLuminance: Math.round(maxLum * 10) / 10, meanLuminance: Math.round((sumLum / (rect.w * rect.h)) * 1000) / 1000, nonBlackPixels: nonBlack, pixels: rect.w * rect.h };
      });

      // Same inspection on the control proves the rectangles are where the PHI is.
      const controlInk = rects.map((rect) => {
        let ink = 0;
        for (let y = rect.y; y < rect.y + rect.h; y++) {
          for (let x = rect.x; x < rect.x + rect.w; x++) {
            const i = (y * controlData.width + x) * 4;
            const lum = 0.299 * controlData.data[i] + 0.587 * controlData.data[i + 1] + 0.114 * controlData.data[i + 2];
            if (lum < 128) ink += 1;
          }
        }
        return { id: rect.id, darkPixels: ink };
      });

      return {
        controlDataUrl,
        dimensions: { width: outboundData.width, height: outboundData.height },
        controlHits,
        outboundPhi,
        outboundNonPhi,
        pixelChecks,
        controlInk,
      };
    }, {
      outboundDataUrl: `data:${outboundMedia};base64,${outboundBase64}`,
      fixtureDataUrl: fixtures.landscape,
      regions: SPEC.regions,
    });

    fs.writeFileSync(path.join(EVIDENCE, "control-unredacted.jpg"), Buffer.from(analysis.controlDataUrl.split(",")[1], "base64"));

    const controlFound = analysis.controlHits.filter((h) => h.found).length;
    check("OCR positive control: every synthetic identifier is readable in an UNredacted encode of the same image",
      controlFound === analysis.controlHits.length,
      { found: controlFound, of: analysis.controlHits.length });

    const leaked = analysis.outboundPhi.filter((h) => h.found);
    check("OCR of the intercepted outbound image finds ZERO synthetic identifiers", leaked.length === 0, {
      leaked: leaked.map((h) => `${h.text} @${h.score}`),
      highestScore: Math.max(...analysis.outboundPhi.map((h) => h.score)),
    });

    const nonPhiFound = analysis.outboundNonPhi.filter((h) => h.found).length;
    check("the same OCR still reads the non-PHI columns of that very image (detector is not blind)",
      nonPhiFound === analysis.outboundNonPhi.length,
      { found: nonPhiFound, of: analysis.outboundNonPhi.length });

    const dirty = analysis.pixelChecks.filter((p) => p.nonBlackPixels > 0);
    check("masked regions are black in the DECODED bytes (pixel inspection, not a DOM overlay)", dirty.length === 0, analysis.pixelChecks);
    check("those same rectangles carried the identifiers before redaction", analysis.controlInk.every((c) => c.darkPixels > 0), analysis.controlInk);

    /* ---- 5. the persisted profile is geometry only ---- */
    const profileWrite = harness.state.storeWrites.find((w) => w.key.startsWith("nrv_redaction_profile"));
    check("a redaction profile was persisted for (user, institution)", !!profileWrite, profileWrite?.key);
    if (profileWrite) {
      const stored = JSON.parse(profileWrite.raw).value;
      const allowed = new Set(["id", "x", "y", "w", "h"]);
      const geometryOnly = stored.regions.every((r) => Object.keys(r).every((k) => allowed.has(k)));
      const identifiers = SPEC.rows.flatMap((r) => [r.name, r.mrn]);
      const noText = !identifiers.some((v) => profileWrite.raw.includes(v));
      check("the stored profile is geometry only", geometryOnly && noText, { key: profileWrite.key, regions: stored.regions });
      results.storedProfile = stored;
    }

    /* ---- 6. a stale profile blocks the next upload ---- */
    const before = harness.state.claudeRequests.length;
    await page.setInputFiles("#shot", portraitPath);
    await page.waitForSelector('[data-testid="redaction-frame"]', { timeout: 20000 });
    check("a screenshot that no longer matches the profile re-prompts instead of uploading",
      harness.state.claudeRequests.length === before,
      { claudeRequestsBefore: before, now: harness.state.claudeRequests.length });
    await page.locator("text=Cancel upload").first().dispatchEvent("click");

    /* ---- capture the session for the PHI log scan ----
       The scanned stream carries the real outbound body (image bytes elided to a
       digest), every value written to storage, and the VERBATIM text the OCR
       managed to recover from the outbound image. If redaction ever failed, the
       recovered identifier lands in this log and phi-log-scan fails on it. */
    for (const write of harness.state.storeWrites) log(`store-write ${write.key} ${write.raw}`);
    const sanitized = JSON.parse(harness.state.claudeRequests[0].raw);
    for (const block of sanitized.attachments || []) {
      if (block?.source?.data) {
        const bytes = Buffer.from(block.source.data, "base64");
        block.source.data = `sha256:${createHash("sha256").update(bytes).digest("hex")} (${bytes.length} bytes elided)`;
      }
    }
    log(`outbound-body ${JSON.stringify(sanitized)}`);
    log(`outbound-image-ocr recovered-identifiers ${JSON.stringify(analysis.outboundPhi.filter((h) => h.found).map((h) => h.text))}`);
    log(`outbound-image-ocr searched=${analysis.outboundPhi.length} recovered=${analysis.outboundPhi.filter((h) => h.found).length} top-score=${Math.max(...analysis.outboundPhi.map((h) => h.score))}`);
    log(`outbound-image-ocr non-phi-readable ${JSON.stringify(analysis.outboundNonPhi.filter((h) => h.found).map((h) => h.text))}`);

    /* ---- 7. the network-boundary guard refuses a hand-built attachment ---- */
    const guard = await page.evaluate(() => {
      const R = window.__redact;
      const forged = [{ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }];
      try {
        R.assertApprovedAttachments(forged);
        return { threw: false };
      } catch (err) {
        return { threw: true, code: err.code, message: err.message };
      }
    });
    check("an image that did not come from redactImage is refused at the network boundary", guard.threw && guard.code === "unredacted-image", guard);

    results.analysis = {
      dimensions: analysis.dimensions,
      controlHits: analysis.controlHits,
      outboundPhi: analysis.outboundPhi,
      outboundNonPhi: analysis.outboundNonPhi,
      pixelChecks: analysis.pixelChecks,
      controlInk: analysis.controlInk,
    };
    results.outbound = {
      mediaType: outboundMedia,
      bytes: Buffer.from(outboundBase64, "base64").length,
      imageBlocks: imageBlocks.length,
      template: outbound.template,
    };

    /* ---- evidence ---- */
    const ocrLines = [
      "N00f — OCR of the intercepted outbound /api/claude image",
      `run: ${results.startedAt}`,
      `browser: ${executablePath}`,
      `outbound image: ${outboundMedia}, ${analysis.dimensions.width}x${analysis.dimensions.height}, ${Buffer.from(outboundBase64, "base64").length} bytes`,
      "",
      "Fixture: SYNTHETIC PHI only (D25a). No real worklist was ever used.",
      "",
      "[1] POSITIVE CONTROL — identical encoder, identical image, zero redaction regions.",
      "    Every identifier below MUST be found, or the detector proves nothing.",
      ...analysis.controlHits.map((h) => `    ${h.found ? "FOUND    " : "not found"}  score=${h.score.toFixed(3)}  @(${h.x},${h.y})  ${h.text}`),
      "",
      "[2] THE INTERCEPTED OUTBOUND IMAGE — every identifier below MUST be absent.",
      ...analysis.outboundPhi.map((h) => `    ${h.found ? "LEAKED   " : "absent   "}  score=${h.score.toFixed(3)}  ${h.text}`),
      "",
      "[3] NON-PHI CONTROL on that same intercepted image — these MUST still be readable,",
      "    which is what rules out 'the OCR found nothing because it cannot see'.",
      ...analysis.outboundNonPhi.map((h) => `    ${h.found ? "readable " : "MISSING  "}  score=${h.score.toFixed(3)}  ${h.text}`),
      "",
      "[4] PIXEL INSPECTION of the decoded outbound bytes inside the masked rectangles:",
      ...analysis.pixelChecks.map((p) => `    ${p.id}: ${p.pixels} px, non-black(>24/255)=${p.nonBlackPixels}, max luminance=${p.maxLuminance}, mean luminance=${p.meanLuminance}`),
      "",
      "[5] The same rectangles in the unredacted control (proof they covered the identifiers):",
      ...analysis.controlInk.map((c) => `    ${c.id}: dark pixels=${c.darkPixels}`),
      "",
      `RESULT: ${leaked.length === 0 && controlFound === analysis.controlHits.length ? "no synthetic identifier survives into the request body" : "FAILED"}`,
    ];
    fs.writeFileSync(path.join(EVIDENCE, "outbound-image-ocr.txt"), ocrLines.join("\n") + "\n");
  } finally {
    await browser.close();
    await harness.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  results.finishedAt = new Date().toISOString();
  results.failures = failures;
  results.passed = failures === 0;
  fs.writeFileSync(path.join(EVIDENCE, "redaction-e2e.json"), JSON.stringify(results, null, 2) + "\n");

  const logText = sessionLog.join("\n") + "\n";
  fs.writeFileSync(path.join(ROOT, "captured-session.log"), logText);
  fs.writeFileSync(path.join(EVIDENCE, "captured-session.log"), logText);

  console.log(`\nredaction-e2e: ${results.checks.length - failures}/${results.checks.length} checks passed`);
  console.log(`evidence: ${path.relative(ROOT, EVIDENCE)}/`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error("redaction-e2e: FAILED —", err && err.stack ? err.stack : err);
  process.exit(1);
});
