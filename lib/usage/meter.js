// Per-user LLM metering: one budget, two callers.
//
//   PWA        /api/claude          -> consumeRateToken + checkCap + recordUsage
//   edge API   /api/v1/resolve      -> POST /api/internal/usage -> the same three
//
// Everything is persisted in Postgres. Nothing here is in-memory, because a
// serverless instance is not a place where a rate limit can live: it is created
// per request, it is not shared, and it forgets.
//
// No prompt text, no completion text and no user content is ever written — the
// table stores counts and a derived dollar figure only (INV-NO-PHI-IN-CLOUD).

import { and, eq, gte, sql } from "drizzle-orm";
import { getDb, llmUsage, llmRateBuckets } from "../db/index.js";

function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Token bucket: `burst` calls available at once, refilled at `refillPerMinute`.
export function rateLimitConfig() {
  return {
    burst: envNumber("LLM_RATE_BURST", 10),
    refillPerMinute: envNumber("LLM_RATE_REFILL_PER_MIN", 10),
  };
}

// Daily spend ceiling, in USD, per user, across BOTH paths.
export function capConfig() {
  return {
    dailyCapUsd: envNumber("LLM_DAILY_CAP_USD", 5),
    inputPerMTok: envNumber("LLM_PRICE_IN_PER_MTOK", 3),
    outputPerMTok: envNumber("LLM_PRICE_OUT_PER_MTOK", 15),
  };
}

/** Dollar estimate for one call. Rounded to 6dp to match the column. */
export function estimateCost(tokensIn, tokensOut) {
  const { inputPerMTok, outputPerMTok } = capConfig();
  const cost =
    (Math.max(0, Number(tokensIn) || 0) / 1e6) * inputPerMTok +
    (Math.max(0, Number(tokensOut) || 0) / 1e6) * outputPerMTok;
  return Math.round(cost * 1e6) / 1e6;
}

/**
 * Atomically refill and consume one token. The whole bucket arithmetic runs
 * inside a single INSERT … ON CONFLICT DO UPDATE, so two concurrent requests
 * cannot both see a full bucket.
 *
 * Returns { allowed, remaining, retryAfterSeconds }.
 */
export async function consumeRateToken(userId) {
  if (!userId) throw new Error("consumeRateToken: userId required");
  const { burst, refillPerMinute } = rateLimitConfig();
  const perSecond = refillPerMinute / 60;

  // One statement, so the refill+consume pair is atomic under the row lock that
  // ON CONFLICT DO UPDATE takes. `greatest(0, tokens)` forgives the at-most-one
  // token of debt a denial leaves behind, so backing off for one refill period
  // buys exactly one call — while hammering does not, because every attempt
  // (allowed or denied) advances updated_at and therefore resets `elapsed`.
  const rows = await getDb().execute(sql`
    insert into llm_rate_buckets (user_id, tokens, updated_at)
    values (${userId}, ${burst - 1}, now())
    on conflict (user_id) do update set
      tokens = least(
        ${burst}::numeric,
        greatest(0::numeric, llm_rate_buckets.tokens)
          + extract(epoch from (now() - llm_rate_buckets.updated_at)) * ${perSecond}::numeric
      ) - 1,
      updated_at = now()
    returning tokens
  `);

  const list = Array.isArray(rows) ? rows : rows?.rows || [];
  const tokens = Number(list[0]?.tokens ?? -1);
  const allowed = tokens >= 0;
  return {
    allowed,
    remaining: Math.max(0, Math.floor(tokens)),
    retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil(1 / perSecond)),
  };
}

function startOfUtcDay() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Daily spend cap. Returns { allowed, remaining } where `remaining` is the
 * dollars left in today's budget for this user.
 */
export async function checkCap(userId) {
  if (!userId) throw new Error("checkCap: userId required");
  const { dailyCapUsd } = capConfig();
  const rows = await getDb()
    .select({ spent: sql`coalesce(sum(${llmUsage.costEstimate}), 0)` })
    .from(llmUsage)
    .where(and(eq(llmUsage.userId, userId), gte(llmUsage.createdAt, startOfUtcDay())));
  const spent = Number(rows[0]?.spent ?? 0);
  const remaining = Math.round((dailyCapUsd - spent) * 1e6) / 1e6;
  return { allowed: remaining > 0, remaining: Math.max(0, remaining), spent, dailyCapUsd };
}

/**
 * Write the usage row for one completed call. Throws on failure — the caller
 * must NOT return 200 for a call it could not account for (INV-NO-SWALLOW).
 *
 * @param source registry template id ("ocr") or service label ("edge-api:resolve")
 */
export async function recordUsage(userId, source, tokensIn, tokensOut) {
  if (!userId) throw new Error("recordUsage: userId required");
  if (!source) throw new Error("recordUsage: source required");
  const inputTokens = Math.max(0, Math.trunc(Number(tokensIn) || 0));
  const outputTokens = Math.max(0, Math.trunc(Number(tokensOut) || 0));
  const costEstimate = estimateCost(inputTokens, outputTokens);
  const rows = await getDb()
    .insert(llmUsage)
    .values({
      userId,
      template: String(source).slice(0, 128),
      inputTokens,
      outputTokens,
      costEstimate: costEstimate.toFixed(6),
    })
    .returning({ id: llmUsage.id });
  if (!rows.length) throw new Error("recordUsage: no row written");
  return { id: rows[0].id, inputTokens, outputTokens, costEstimate };
}
