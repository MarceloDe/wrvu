// Browser entry for the N00f redaction e2e.
//
// It mounts the REAL dashboard component (components/NeuroRVU.jsx) — not a
// stand-in — so the upload path exercised by the test is the upload path users
// run. The only additions are the fixture generator and the OCR, hung off
// window for the driver to call. No application code is stubbed.

import React from "react";
import { createRoot } from "react-dom/client";
import NeuroRVU from "../../../components/NeuroRVU";
import {
  RedactionError,
  assertGeometryOnly,
  assertNoUnredactedImages,
  redactImage,
  redactImageBlock,
  resolveRegions,
} from "../../../lib/redact/imageRedactor";
import * as capture from "../../../lib/redact/captureRedaction";
import { canvasToImageData, dataUrlToImageData, drawSyntheticWorklist, renderTemplate } from "./fixture";
import { findTemplate } from "./ocr";
import spec from "../fixtures/synthetic-identifiers.json";

window.__redact = {
  RedactionError,
  assertGeometryOnly,
  assertNoUnredactedImages,
  redactImage,
  redactImageBlock,
  resolveRegions,
  capture,
  spec,
  drawSyntheticWorklist,
  renderTemplate,
  canvasToImageData,
  dataUrlToImageData,
  findTemplate,
};

createRoot(document.getElementById("root")).render(<NeuroRVU />);
