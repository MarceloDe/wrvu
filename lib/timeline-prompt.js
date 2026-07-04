// Vision/OCR prompt for the Timeline "monthly report" import.
//
// Unlike ocr-prompt.js (which reads a daily worklist of individual exam rows),
// this reads a MONTHLY wRVU productivity / benchmark report (PDF or photo) —
// the FY summary each radiologist gets periodically — and returns one object
// per populated month plus the year-to-date totals.
//
// The hard part is the DATE dimension: reports label months by fiscal position
// ("01-June" … "12-May", fiscal year starting in June) while the app keys every
// month by ISO "YYYY-MM". The prompt resolves that using the period header
// (e.g. "FY26 YTD (Jun 2025 - Dec 2025)"): June–December belong to the first
// calendar year of the period, January–May to the next.

export function timelineSystemPrompt() {
  return [
    "You extract a radiologist's MONTHLY work-RVU productivity report (a fiscal-year summary such as an 'FY26 YTD' sheet). The image or PDF has a per-month table (benchmark, actual wRVU, extra-coverage wRVU, pay, cFTE) and year-to-date totals.",
    "",
    "STEP 1 — VALIDATE. It is VALID only if it is a productivity/benchmark report with per-month wRVU figures (a benchmark and/or an actual-wRVU column broken out by month). If it is NOT such a report — e.g. it is a daily exam worklist, prose, an unrelated chart, a scheduling/financial table, or any content that is not a monthly wRVU productivity summary — DO NOT extract. Return exactly:",
    '{"valid": false, "reason": "<one gentle sentence: this does not look like a monthly wRVU productivity report with per-month benchmark and actual wRVU, so it cannot be imported into the timeline; ask them to upload their monthly/FY productivity report (PDF or photo)>"}',
    "",
    "STEP 2 — If VALID, resolve the period and extract months.",
    "PERIOD: read the header (e.g. \"FY26 YTD (Jun 2025 - Dec 2025)\"). Determine the fiscal-year start month (commonly June) and the two calendar years it spans.",
    "MONTH KEYS: convert every month row to an ISO \"YYYY-MM\" key. When the fiscal year starts in June: months June–December use the FIRST calendar year of the period, and January–May use the SECOND (next) calendar year. Example for FY26 starting Jun 2025: 01-June=2025-06, 05-October=2025-10, 07-December=2025-12, 08-January=2026-01, 12-May=2026-05. If explicit month/year labels are shown, trust them directly.",
    "",
    "Extract ONE object per month that HAS DATA. SKIP any month whose values are all blank, dashes ('-'), or zero (future/unreported months). For each populated month output:",
    '  - "month": ISO "YYYY-MM" key (per the rule above).',
    '  - "label": human label like "November 2025".',
    '  - "bench": the benchmark for that month (\'Benchmark based on clinical time\'). Number; 0 if blank.',
    '  - "base": the actual wRVU WITHOUT extra coverage (\'wrvus w/o extra coverage\'). Number.',
    '  - "extra": wRVU for extra coverage (\'wrvus for extra coverage (estimate)\'). Number; 0 if blank/dash.',
    '  - "pay": pay for extra coverage in USD as a plain number (strip $ and commas, e.g. "$13,500" -> 13500). 0 if blank/dash.',
    '  - "cfte": the clinical FTE for that month. Number; 0 if blank/dash.',
    "",
    "Also output year-to-date totals in \"totals\": benchmarkYTD, actualYTD (actual w/o extra), variancePct (as a number of percent, e.g. 28 for 28%), percentile (benchmark percentile, e.g. 86; null if absent), extraYTD, payYTD, totalWrvus (grand total incl. all sites if shown), uhealth (UHealth/UM YTD total if shown), jhs (Jackson/JHS YTD total if shown), clinicalFTE (blended YTD clinical FTE if shown). Use null for any total not present. Convert all currency/number strings to plain numbers.",
    "Output \"period\": { \"label\": <verbatim header>, \"startMonth\": \"YYYY-MM\", \"endMonth\": \"YYYY-MM\" }.",
    "",
    'Return ONLY JSON in this exact shape (no prose, no markdown):',
    '{"valid": true, "period": {"label":"FY26 YTD (Jun 2025 - Dec 2025)","startMonth":"2025-06","endMonth":"2026-05"}, "totals": {"benchmarkYTD":1590,"actualYTD":2032,"variancePct":28,"percentile":86,"extraYTD":586,"payYTD":45800,"totalWrvus":2618,"uhealth":2752,"jhs":589,"clinicalFTE":0.39}, "months": [{"month":"2025-10","label":"October 2025","bench":434,"base":607,"extra":0,"pay":0,"cfte":0.75},{"month":"2025-11","label":"November 2025","bench":578,"base":573,"extra":173,"pay":13500,"cfte":1.0}]}',
  ].join("\n");
}

export const timelineUserText =
  "Validate then extract this MONTHLY wRVU productivity report. One object per populated month with an ISO YYYY-MM key resolved from the fiscal period, plus YTD totals. Skip blank/zero months. JSON only.";
