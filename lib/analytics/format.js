// Number and date formatting shared by the dashboard and the analytics modules.
//
// Extracted from components/NeuroRVU.jsx (N06). Pure functions, no React, no DOM — so
// the parts of this app that decide money can be tested without mounting a component.

/** Number coercion that never yields NaN. A NaN in a total is silent and contagious. */
export const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export const fmt = (n, d = 0) =>
  Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

export const monthKey = (iso) => iso.slice(0, 7);
export const pad2 = (n) => String(n).padStart(2, "0");

/** Local calendar day, not UTC. The app's day boundaries are the radiologist's, not Greenwich's. */
export const localDay = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const localMonth = (d = new Date()) => localDay(d).slice(0, 7);
export const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return localDay(d); };

export const MONTH_LABEL = (k) => {
  const [y, m] = k.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
};
