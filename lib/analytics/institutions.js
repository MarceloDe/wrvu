// Which institution a raw site string belongs to.
//
// Extracted from components/NeuroRVU.jsx (N06). THIS IS THE FILE N18 REPLACES: today the
// set is three hardcoded keys, and the founder has chosen to generalise it to N
// user-created institutions with UM and JHS seeded so behaviour is unchanged. Isolating
// it first means that change is a rewrite of one small module under test, rather than
// 71 scattered edits inside a 1,800-line component.
//
// INV-SITE-NEVER-FAILS: classification never rejects a row. An unrecognised site returns
// "Other" and the raw string is preserved on the exam, because losing the study is worse
// than filing it in the wrong bucket.

export const INSTITUTIONS = {
  UM:    { key:"UM",    label:"UHealth / UM", short:"UM",  color:"#f97316", match:/uhealth|university\s*of\s*miami|sylvester|bascom|\bum[a-z0-9\-_]*/i },
  JHS:   { key:"JHS",   label:"Jackson / JHS", short:"JHS", color:"#0ea5e9", match:/jackson|\bjhs\b|\bjhm\b|\bjmh\b|holtz|ryder/i },
  Other: { key:"Other", label:"Other / Unassigned", short:"Other", color:"#94a3b8", match:null },
};
export function classifyInstitution(raw) {
  if (!raw) return "Other";
  const s = String(raw).trim();
  if (s === "UM" || s === "JHS" || s === "Other") return s;
  if (/^\s*um/i.test(s)) return "UM";                 // PRIMARY: any site starting with UM
  if (INSTITUTIONS.UM.match.test(s)) return "UM";
  if (INSTITUTIONS.JHS.match.test(s)) return "JHS";
  return "Other";
}
export const instMeta = (k) => INSTITUTIONS[k] || INSTITUTIONS.Other;
