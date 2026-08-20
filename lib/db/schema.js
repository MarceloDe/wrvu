// Drizzle schema (Neon Postgres).
//
// Design goals:
//  - Multi-tenant: every row is scoped to a Clerk user id.
//  - Reference/pricing data does NOT live here. It is the versioned `reference` schema
//    (drizzle/0003), 828 codes at (hcpcs, modifier) grain from CMS RVU26A, read only
//    through lib/pricing/resolveValue(). rvuTables/rvuCodes used to model fee schedules
//    here and were dropped in 0006: they held a 61-code copy that disagreed with CMS on
//    54 of them, and nothing read them.
//  - Zero-churn app: userKv backs the existing /api/store key/value contract so
//    the dashboard's timeline / baseline / settings persist per user untouched.

import {
  pgTable, text, timestamp, jsonb, uuid, numeric, boolean, integer, index, primaryKey,
} from "drizzle-orm/pg-core";

// Mirror of Clerk users (Clerk remains the source of truth for auth).
// Handy for joins / admin views and for storing an app-level role.
export const users = pgTable("users", {
  id: text("id").primaryKey(),                 // Clerk user id (user_xxx)
  email: text("email"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  role: text("role").notNull().default("user"), // 'user' | 'admin'
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Per-user key/value blobs — backs /api/store (keys: nrv_log, nrv_baseline, nrv_settings).
export const userKv = pgTable(
  "user_kv",
  {
    userId: text("user_id").notNull(),
    key: text("key").notNull(),
    value: jsonb("value"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.key] }) }),
);

// One row per logged exam (source of truth for the tracker/timeline).
// A "batch"/cluster = all exams sharing batchId (one upload). uploadedAt groups
// by the day the batch was inserted; examDate is the exam's own date from OCR.
export const exams = pgTable(
  "exams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    batchId: text("batch_id").notNull(),
    examDate: timestamp("exam_date", { withTimezone: true }),
    cpt: text("cpt"),
    procedure: text("procedure"),
    site: text("site"),
    institution: text("institution"),
    modality: text("modality"),
    wrvu: numeric("wrvu").notNull().default("0"),
    estimated: boolean("estimated").notNull().default(false),
    source: text("source").notNull().default("screenshot"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
    // Added by 0004. `wrvu` stays NOT NULL because the dashboard sums with `+=` and a
    // NULL would poison every total as NaN; `wrvuState` is what says whether that number
    // is a price at all. Declared here because a column the ORM does not know about is
    // silently dropped from `db.select().from(exams)` and unsettable by `db.insert`.
    wrvuState: text("wrvu_state"),
    pricedFrom: text("priced_from"),
    // Added by 0008 (N18). Nullable: a user who has never opened Settings has no
    // institution rows, and INV-SITE-NEVER-FAILS means that must still work.
    institutionId: uuid("institution_id"),
  },
  (t) => ({
    byUserDate: index("exams_user_date_idx").on(t.userId, t.examDate),
    byUserBatch: index("exams_user_batch_idx").on(t.userId, t.batchId),
  }),
);

// Extra-duty work (paid separately from the monthly wRVU target/flow).
// One row per tagged bundle/shift — an AGGREGATE, not per-exam. Deliberately NOT
// stored in `exams` so the wRVU target math and all existing analytics are
// untouched. Two pay models:
//   - 'per_diem': flat rate for a shift; earnings = `amount` (a snapshot).
//   - 'ppc' (pay-per-click): paid per exam by modality; earnings = the snapshot
//     `amount` = countMri*rate.mri + countCt*rate.ct + countXr*rate.xr.
// `amount` + `rateSnapshot` are frozen at save time so editing rates later never
// re-prices past shifts.
export const extraDutyPeriods = pgTable(
  "extra_duty_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    bundleDate: timestamp("bundle_date", { withTimezone: true }).notNull(),
    payModel: text("pay_model").notNull(),        // 'per_diem' | 'ppc'
    examCount: integer("exam_count").notNull().default(0),
    countMri: integer("count_mri").notNull().default(0),
    countCt: integer("count_ct").notNull().default(0),
    countXr: integer("count_xr").notNull().default(0),
    countOther: integer("count_other").notNull().default(0), // unmapped, not paid
    amount: numeric("amount").notNull().default("0"),         // $ snapshot at save
    rateSnapshot: jsonb("rate_snapshot"),                     // { perDiem, mri, ct, xr }
    label: text("label"),
    batchId: text("batch_id"),                    // originating upload (provenance)
    source: text("source").notNull().default("manual"),      // 'manual' | 'screenshot'
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ byUserDate: index("extra_duty_user_date_idx").on(t.userId, t.bundleDate) }),
);

// Per-user extra-duty pay rates (one current-value row per user). Historical
// correctness lives in each period's `amount`/`rateSnapshot`, so no effective-dating.
export const extraDutyRates = pgTable("extra_duty_rates", {
  userId: text("user_id").primaryKey(),
  perDiemRate: numeric("per_diem_rate").notNull().default("0"),
  ppcMri: numeric("ppc_mri").notNull().default("0"),
  ppcCt: numeric("ppc_ct").notNull().default("0"),
  ppcXr: numeric("ppc_xr").notNull().default("0"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// LLM metering (N00c). Both LLM paths — the PWA's /api/claude and the edge
// API's /api/v1/resolve, which reports in through /api/internal/usage — bill
// against ONE per-user budget recorded here. Additive: nothing else reads or
// writes these tables, and dropping them restores the previous behaviour.
// ---------------------------------------------------------------------------

// One row per completed model call. `template` is the registry template id for
// the PWA path, or a "<service>:<route>" source label for the edge path.
// No prompt, no completion and no user content is ever stored — counts only.
export const llmUsage = pgTable(
  "llm_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    template: text("template").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costEstimate: numeric("cost_estimate", { precision: 12, scale: 6 }).notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ byUserCreated: index("llm_usage_user_created_idx").on(t.userId, t.createdAt) }),
);

// Persisted token bucket, one row per user. Refill is computed in SQL from
// updated_at inside a single atomic upsert, so the limit survives a cold start
// and holds across every serverless instance (an in-memory bucket does neither).
export const llmRateBuckets = pgTable("llm_rate_buckets", {
  userId: text("user_id").primaryKey(),
  tokens: numeric("tokens", { precision: 12, scale: 4 }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
