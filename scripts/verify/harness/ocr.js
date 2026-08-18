// Glyph-template OCR for the synthetic fixture.
//
// Why not a general OCR engine: the fixture is drawn by this same browser, so a
// normalised cross-correlation against a template rendered with the identical
// rasteriser is a STRICTER detector than a general engine — it fires on text a
// general engine would miss (partially masked, low contrast, tiny). Its validity
// is never assumed: every run proves the detector on the SAME encoded image by
// requiring it to still find the non-PHI strings (site, procedure, exam date)
// that must survive redaction. A detector that found nothing at all would fail
// that control and the run would fail with it.

function toGray(imageData) {
  const { width, height, data } = imageData;
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return { width, height, gray };
}

function inkIntegral(gray, width, height, threshold) {
  // integral[(y)(width+1) + x] = count of ink pixels above-left of (x, y)
  const integral = new Int32Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      if (gray[y * width + x] < threshold) rowSum++;
      integral[(y + 1) * (width + 1) + (x + 1)] = integral[y * (width + 1) + (x + 1)] + rowSum;
    }
  }
  return integral;
}

const windowInk = (integral, width, x, y, w, h) =>
  integral[(y + h) * (width + 1) + (x + w)] -
  integral[y * (width + 1) + (x + w)] -
  integral[(y + h) * (width + 1) + x] +
  integral[y * (width + 1) + x];

function ncc(gray, width, x0, y0, tpl, tw, th, tplMean, tplNorm) {
  let sum = 0;
  let sumSq = 0;
  for (let y = 0; y < th; y++) {
    const base = (y0 + y) * width + x0;
    for (let x = 0; x < tw; x++) {
      const v = gray[base + x];
      sum += v;
      sumSq += v * v;
    }
  }
  const n = tw * th;
  const mean = sum / n;
  const varSum = sumSq - n * mean * mean;
  if (varSum <= 1e-6) return 0;
  const norm = Math.sqrt(varSum);
  let dot = 0;
  for (let y = 0; y < th; y++) {
    const base = (y0 + y) * width + x0;
    const tbase = y * tw;
    for (let x = 0; x < tw; x++) {
      dot += (gray[base + x] - mean) * (tpl[tbase + x] - tplMean);
    }
  }
  return dot / (norm * tplNorm);
}

/**
 * Search `imageData` for a string rendered as `templateImageData`.
 * Returns { text, score, x, y, found }.
 */
export function findTemplate(imageData, templateImageData, text, options = {}) {
  const threshold = options.threshold ?? 0.75;
  const inkThreshold = options.inkThreshold ?? 160;
  const target = toGray(imageData);
  const tplGray = toGray(templateImageData);
  const tw = tplGray.width;
  const th = tplGray.height;
  if (tw >= target.width || th >= target.height) return { text, score: 0, x: -1, y: -1, found: false };

  let tplSum = 0;
  let tplSumSq = 0;
  let tplInk = 0;
  for (let i = 0; i < tplGray.gray.length; i++) {
    const v = tplGray.gray[i];
    tplSum += v;
    tplSumSq += v * v;
    if (v < inkThreshold) tplInk++;
  }
  const n = tw * th;
  const tplMean = tplSum / n;
  const tplNorm = Math.sqrt(Math.max(tplSumSq - n * tplMean * tplMean, 1e-6));

  const integral = inkIntegral(target.gray, target.width, target.height, inkThreshold);
  const inkTolerance = Math.max(4, Math.round(tplInk * 0.45));

  let best = { score: -1, x: -1, y: -1 };
  const maxY = target.height - th;
  const maxX = target.width - tw;
  for (let y = 0; y <= maxY; y++) {
    for (let x = 0; x <= maxX; x++) {
      const ink = windowInk(integral, target.width, x, y, tw, th);
      if (Math.abs(ink - tplInk) > inkTolerance) continue;
      const score = ncc(target.gray, target.width, x, y, tplGray.gray, tw, th, tplMean, tplNorm);
      if (score > best.score) best = { score, x, y };
    }
  }
  return { text, score: Math.round(best.score * 1000) / 1000, x: best.x, y: best.y, found: best.score >= threshold };
}
