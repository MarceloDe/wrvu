// Which institution a raw site string belongs to.
//
// N18 made this data-driven. It used to be three hardcoded keys; it is now a list, and
// the default list reproduces the old behaviour exactly so nothing visibly changed when
// it landed. The list will come from the `institutions` table once the UI reads it.
//
// INV-SITE-NEVER-FAILS: classification never rejects a row. Anything unrecognised lands
// in the default institution with the raw string preserved on the exam. Losing a study
// because nobody had mapped its site is the failure that must not happen — the doctor
// did the work either way.

/** The seeded set. Matches what the app has always shipped, so behaviour is unchanged. */
export const DEFAULT_INSTITUTIONS = [
  { key: "UM",    label: "UHealth / UM",      short: "UM",    color: "#f97316",
    // PRIMARY rule: any site starting with "um". Kept as a distinct field rather than
    // folded into `match` because it must run BEFORE every other institution's regex —
    // a site called "UMHC" must not be captured by a later, broader pattern.
    prefix: /^\s*um/i,
    match: /uhealth|university\s*of\s*miami|sylvester|bascom|\bum[a-z0-9\-_]*/i },
  { key: "JHS",   label: "Jackson / JHS",     short: "JHS",   color: "#0ea5e9",
    match: /jackson|\bjhs\b|\bjhm\b|\bjmh\b|holtz|ryder/i },
  { key: "Other", label: "Other / Unassigned", short: "Other", color: "#94a3b8",
    match: null, isDefault: true },
];

/** Keyed lookup, for colour/label rendering. */
export function indexOf(institutions = DEFAULT_INSTITUTIONS) {
  return Object.fromEntries(institutions.map((i) => [i.key, i]));
}

export const defaultKeyOf = (institutions = DEFAULT_INSTITUTIONS) =>
  (institutions.find((i) => i.isDefault) ?? institutions[institutions.length - 1]).key;

/**
 * Build a classifier for a given institution list.
 *
 * Priority, unchanged from the hardcoded version:
 *   1. the raw string IS an institution key (a value the app itself wrote)
 *   2. any institution's `prefix`, in list order
 *   3. any institution's `match`, in list order
 *   4. the default institution
 */
export function makeClassifier(institutions = DEFAULT_INSTITUTIONS, overrides = {}) {
  const fallback = defaultKeyOf(institutions);
  const keys = new Set(institutions.map((i) => i.key));
  return function classify(raw) {
    if (!raw) return fallback;
    const s = String(raw).trim();
    if (!s) return fallback;
    // A user-defined site mapping wins over every pattern — this is the iOS `nrv_sites`
    // behaviour, which the PWA lacked.
    const mapped = overrides[s.toUpperCase()];
    if (mapped && keys.has(mapped)) return mapped;
    if (keys.has(s)) return s;
    for (const i of institutions) if (i.prefix?.test(s)) return i.key;
    for (const i of institutions) if (i.match?.test(s)) return i.key;
    return fallback;
  };
}

/** The app-wide classifier over the seeded set. */
export const classifyInstitution = makeClassifier();

// Back-compat for call sites that still expect the keyed object.
export const INSTITUTIONS = indexOf();
export const instMeta = (k) => INSTITUTIONS[k] || INSTITUTIONS[defaultKeyOf()];
