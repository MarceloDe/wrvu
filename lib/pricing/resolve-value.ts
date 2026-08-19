// N14 — resolveValue(): the ONE path a wRVU may come from.
//
// Before this, both clients priced locally from tables that disagreed on 55 of 61
// codes, and /api/exams stored whatever number arrived. The database therefore holds a
// mixture, with no column recording which table produced any given row. Pricing has to
// move server-side before unifying the table means anything, because otherwise the
// clients keep computing their own answers from whatever they happen to ship with.
//
// TWO RULES, and the second is the one that gets broken quietly.
//
//   1. Every wRVU the product shows originates here (INV-MONEY-ONE-PATH).
//   2. When there is no value, this returns NULL and says why. It never returns 0 as a
//      stand-in and never invents an estimate (INV-NO-ESTIMATES). A status-C code is
//      contractor-priced: CMS publishes no national figure, so 0 understates real pay,
//      and the old table's invented 1.43–2.2 was an estimate presented as fact. Both
//      are wrong in opposite directions; `state` lets the caller say "not priced here"
//      instead of picking one.
//
// Work RVU is deliberately modifier-insensitive between '' and '26': the technical
// component carries no physician work, so the global and professional figures are the
// same number. TC is never selected as a default — reading a study is professional work.

import { getUnscopedSql } from "../db/index.js";   // relative, so plain Node scripts can import this too

export type PriceState =
  | "priced"
  | "no_physician_work"
  | "contractor_priced"
  | "not_payable"
  | "unpriced_other"
  | "unknown_code";

export interface Valuation {
  hcpcs: string;
  modifier: string | null;
  state: PriceState;
  /** NULL unless state is "priced" or "no_physician_work". Never a placeholder. */
  workRvu: number | null;
  descriptor: string | null;
  /** CMS modality for the code (XR, CT, MRI, NM, US, …). NULL when unknown — never
   *  guessed. A guessed modality decides which PPC bucket a study is PAID from. */
  modality: string | null;
  statusCode: string | null;
  sourceRelease: string | null;
  conversionFactor: number | null;
  /** The fee schedule version this answer came from; stored on the exam as provenance. */
  versionId: string | null;
}

/** True when a valuation carries a number the product may display or sum. */
export function isPriced(v: Valuation): boolean {
  return v.workRvu !== null;
}

/** Why a valuation has no number, in words a user can act on. */
export function explain(v: Valuation): string {
  switch (v.state) {
    case "priced": return "";
    case "no_physician_work": return "No physician work component (technical component).";
    case "contractor_priced": return "Contractor-priced: CMS publishes no national work RVU for this code.";
    case "not_payable": return `Not separately payable under the fee schedule (status ${v.statusCode}).`;
    case "unpriced_other": return `No national work RVU published (status ${v.statusCode}).`;
    case "unknown_code": return "Not present in the loaded CMS release.";
  }
}

const unknown = (hcpcs: string, modifier: string | null, versionId: string | null = null): Valuation => ({
  hcpcs, modifier, state: "unknown_code", workRvu: null,
  descriptor: null, modality: null, statusCode: null, sourceRelease: null, conversionFactor: null, versionId,
});

interface Row {
  hcpcs: string; modifier: string; work_rvu: string | number | null;
  price_state: PriceState; status_code: string; descriptor: string | null; modality: string | null;
  source_release: string; conversion_factor: string | number; version_id: string;
}

function toValuation(r: Row): Valuation {
  return {
    hcpcs: r.hcpcs,
    modifier: r.modifier,
    state: r.price_state,
    // numeric arrives as a string from the driver; null must stay null, not become 0.
    workRvu: r.work_rvu === null ? null : Number(r.work_rvu),
    descriptor: r.descriptor,
    modality: r.modality,
    statusCode: r.status_code,
    sourceRelease: r.source_release,
    conversionFactor: Number(r.conversion_factor),
    versionId: r.version_id,
  };
}

/**
 * Price one code against the current CMS release.
 *
 * Prefers the professional component ('26') and falls back to the global row, which
 * carries the same work RVU. Passing a modifier explicitly pins the lookup.
 */
export async function resolveValue(hcpcs: string, opts: { modifier?: string } = {}): Promise<Valuation> {
  const code = String(hcpcs ?? "").trim().toUpperCase().replace(/^\+/, "");
  if (!code) return unknown(code, opts.modifier ?? null);
  const [only] = await resolveMany([{ hcpcs: code, modifier: opts.modifier }]);
  return only;
}

/** Price many codes in one round trip. Order and length always match the input. */
export async function resolveMany(
  requests: ReadonlyArray<{ hcpcs: string; modifier?: string }>,
): Promise<Valuation[]> {
  if (requests.length === 0) return [];
  const codes = [...new Set(requests.map((r) => String(r.hcpcs ?? "").trim().toUpperCase().replace(/^\+/, "")).filter(Boolean))];
  if (codes.length === 0) return requests.map((r) => unknown(String(r.hcpcs ?? ""), r.modifier ?? null));

  const sql = getUnscopedSql();
  const rows = (await sql`
    select r.hcpcs, r.modifier, r.work_rvu, r.price_state, r.status_code,
           c.descriptor, c.modality, v.source_release, v.conversion_factor, v.id as version_id
    from reference.code_rvus r
    join reference.fee_schedule_versions v on v.id = r.version_id and v.is_current
    left join reference.procedure_codes c on c.version_id = r.version_id and c.hcpcs = r.hcpcs
    where r.hcpcs = any(${codes})
  `) as unknown as Row[];

  const byKey = new Map<string, Row>();
  for (const r of rows) byKey.set(`${r.hcpcs}|${r.modifier}`, r);
  // An unrecognised code was still evaluated against a specific release; recording which
  // one is what makes "unknown_code" reviewable later instead of merely unexplained.
  const currentVersion = rows.length
    ? rows[0].version_id
    : ((await sql`select id from reference.fee_schedule_versions where is_current`) as unknown as Array<{ id: string }>)[0]?.id ?? null;

  return requests.map((req) => {
    const code = String(req.hcpcs ?? "").trim().toUpperCase().replace(/^\+/, "");
    if (!code) return unknown(code, req.modifier ?? null, currentVersion);
    if (req.modifier !== undefined) {
      const exact = byKey.get(`${code}|${req.modifier}`);
      return exact ? toValuation(exact) : unknown(code, req.modifier, currentVersion);
    }
    // Professional component first, then the global row — identical work RVU, but '26'
    // is what a radiologist actually bills. TC is never a default.
    const pro = byKey.get(`${code}|26`) ?? byKey.get(`${code}|`);
    return pro ? toValuation(pro) : unknown(code, null, currentVersion);
  });
}
