// SYNTHETIC PHI worklist fixture (D25a) — drawn in the browser so the OCR
// templates below are rendered by the exact same text rasteriser.
//
// Real patient data must never be used here: doing so would perform the very
// disclosure N00f exists to stop.

export function drawSyntheticWorklist(spec, { transpose = false } = {}) {
  const L = spec.layout;
  const width = transpose ? L.height : L.width;
  const height = transpose ? L.width : L.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.font = L.font;
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = "#000000";
  ctx.fillText("PATIENT NAME", L.columns.name, L.headerY);
  ctx.fillText("MRN", L.columns.mrn, L.headerY);
  ctx.fillText("SITE", L.columns.site, L.headerY);
  ctx.fillText("PROCEDURE", L.columns.procedure, L.headerY);
  ctx.fillText("EXAM DATE", L.columns.date, L.headerY);
  ctx.strokeStyle = "#000000";
  ctx.beginPath();
  ctx.moveTo(0, L.headerY + 10);
  ctx.lineTo(width, L.headerY + 10);
  ctx.stroke();

  spec.rows.forEach((row, i) => {
    const y = L.firstRowY + i * L.rowStep;
    if (y > height - 10) return;
    ctx.fillStyle = "#000000";
    ctx.fillText(row.name, L.columns.name, y);
    ctx.fillText(row.mrn, L.columns.mrn, y);
    ctx.fillText(row.site, L.columns.site, y);
    ctx.fillText(row.procedure, L.columns.procedure, y);
    ctx.fillText(row.date, L.columns.date, y);
  });
  return canvas;
}

/** Render one string exactly as the fixture renders it — the OCR template. */
export function renderTemplate(text, font) {
  const probe = document.createElement("canvas").getContext("2d");
  probe.font = font;
  const metrics = probe.measureText(text);
  const w = Math.ceil(metrics.width) + 2;
  const ascent = Math.ceil(metrics.actualBoundingBoxAscent || 16);
  const descent = Math.ceil(metrics.actualBoundingBoxDescent || 5);
  const h = ascent + descent + 2;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.font = font;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#000000";
  ctx.fillText(text, 1, ascent + 1);
  return ctx.getImageData(0, 0, w, h);
}

export function canvasToImageData(canvas) {
  return canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
}

export async function dataUrlToImageData(dataUrl) {
  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("decode-failed"));
    im.src = dataUrl;
  });
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, img.width, img.height);
}
