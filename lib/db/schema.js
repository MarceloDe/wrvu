// Drizzle schema (Neon Postgres).
//
// Design goals:
//  - Multi-tenant: every row is scoped to a Clerk user id.
//  - "Many wRVU tables": rvuTables/rvuCodes model an arbitrary number of fee
//    schedules. The seeded CMS-2026 neuro table is just `is_system = true`;
//    future "company uploads" are the same shape with owner_id + source.
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

// A wRVU fee schedule. System tables (CMS) have owner_id = null + is_system = true.
// User/company tables have owner_id = <clerk user id> + source = 'company-upload'.
export const rvuTables = pgTable("rvu_tables", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id"),                    // null => global/system table
  name: text("name").notNull(),
  source: text("source").notNull().default("custom"), // 'CMS-2026' | 'company-upload' | 'custom'
  year: integer("year"),
  conversionFactor: numeric("conversion_factor"),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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
  },
  (t) => ({
    byUserDate: index("exams_user_date_idx").on(t.userId, t.examDate),
    byUserBatch: index("exams_user_batch_idx").on(t.userId, t.batchId),
  }),
);

// Rows inside a wRVU table.
export const rvuCodes = pgTable(
  "rvu_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tableId: uuid("table_id").notNull().references(() => rvuTables.id, { onDelete: "cascade" }),
    cpt: text("cpt").notNull(),
    modality: text("modality"),
    region: text("region"),
    description: text("description"),
    contrast: text("contrast"),
    wrvu: numeric("wrvu").notNull(),
    meta: jsonb("meta"),                        // { est, flag, ... }
  },
  (t) => ({ byTable: index("rvu_codes_table_idx").on(t.tableId) }),
);
