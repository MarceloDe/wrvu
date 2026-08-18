// The one and only error envelope.
//
// Every non-2xx response the app produces is built here, and it carries exactly
// two things: a generic, stable `code` the client can branch on, and a
// `correlationId` that also appears in the server log line for the same
// failure. Driver text, constraint names, SQL, stack traces and upstream-vendor
// messages stay on the server (INV-NO-RAW-ERRORS).
//
// Edge-safe: no node builtins.

import { logServerError } from "../observability/logger.ts";

/** Generic, caller-safe failure codes. Nothing here names a table, column,
 *  driver or vendor — adding a code that does is a leak. */
export const ERROR_CODES = [
  "unauthorized",
  "forbidden",
  "not_found",
  "bad_request",
  "invalid_json",
  "validation_failed",
  "config_missing",
  "storage_unavailable",
  "internal_error",
  "upstream_unavailable",
  "upstream_rate_limited",
  "upstream_overloaded",
  "upstream_timeout",
  "upstream_payload_too_large",
  "upstream_invalid_image",
  "upstream_rejected",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorEnvelope {
  error: { code: ErrorCode; correlationId: string };
}

export const CORRELATION_HEADER = "x-correlation-id";

/** A fresh correlation id. Same value goes to the caller and to the log line. */
export function newCorrelationId(): string {
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // Deterministic fallback for runtimes without WebCrypto.
  return `cid_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** The response body — and the whole body. Exported so non-Response callers
 *  (middleware builds a NextResponse) emit the identical shape. */
export function errorPayload(code: ErrorCode, correlationId: string): ErrorEnvelope {
  return { error: { code, correlationId } };
}

/**
 * Build the error response. The body is `{ error: { code, correlationId } }`
 * and nothing else.
 */
export function fail(code: ErrorCode, correlationId: string, status: number): Response {
  return Response.json(errorPayload(code, correlationId), {
    status,
    headers: { [CORRELATION_HEADER]: correlationId },
  });
}

export interface FailContext {
  /** e.g. "POST /api/store" */
  route: string;
  correlationId: string;
  /** The real cause — logged, never returned. */
  cause?: unknown;
  /** Operator-facing note — logged, never returned. */
  message?: string;
}

/**
 * Log the failure (with the correlation id) and return the envelope.
 * Every non-2xx in the app goes through here, so no failure is silent and no
 * response is un-correlated.
 */
export function failLogged(code: ErrorCode, status: number, ctx: FailContext): Response {
  logServerError({
    route: ctx.route,
    correlationId: ctx.correlationId,
    code,
    status,
    ...(ctx.message ? { message: ctx.message } : {}),
    ...(ctx.cause !== undefined ? { cause: ctx.cause } : {}),
  });
  return fail(code, ctx.correlationId, status);
}

export interface RouteContext {
  correlationId: string;
  /** Log + envelope in one call, with `route` already bound. */
  fail: (code: ErrorCode, status: number, extra?: { cause?: unknown; message?: string }) => Response;
}

type Handler = (req: Request, ctx: RouteContext) => Promise<Response> | Response;

/**
 * Wrap a route handler so that anything thrown — including a driver blowing up
 * mid-query — becomes a logged, correlated, generic 500 instead of a stack
 * trace on the wire.
 */
export function withErrorEnvelope(routeName: string, handler: Handler) {
  return async function wrapped(req: Request): Promise<Response> {
    const correlationId = newCorrelationId();
    const route = `${req?.method || "?"} ${routeName}`;
    const ctx: RouteContext = {
      correlationId,
      fail: (code, status, extra) =>
        failLogged(code, status, { route, correlationId, cause: extra?.cause, message: extra?.message }),
    };
    try {
      return await handler(req, ctx);
    } catch (err) {
      return failLogged("internal_error", 500, { route, correlationId, cause: err });
    }
  };
}
