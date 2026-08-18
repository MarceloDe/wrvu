// Structured server-side logging.
//
// One JSON object per line on stderr (Vercel/`next dev` capture stdout+stderr),
// plus a best-effort ship to a monitoring destination so failures are visible
// somewhere other than a terminal that nobody is watching.
//
// The log line is the ONLY place a driver/vendor error string is allowed to
// appear. Response bodies never carry it (see lib/http/errors.ts) — the
// correlation id is the join key between what the user saw and what happened.
//
// Edge-safe: no node builtins, only `fetch`, `console` and `crypto`.

export type LogLevel = "error" | "warn" | "info";

export interface ServerLogEvent {
  /** Route or subsystem the failure came from, e.g. "POST /api/store". */
  route: string;
  /** The id echoed to the caller in the error envelope. */
  correlationId: string;
  /** The generic code the caller was given. */
  code: string;
  /** HTTP status the caller was given. */
  status: number;
  /** Optional operator-facing note. */
  message?: string;
  /** The real cause. Stays server-side. */
  cause?: unknown;
}

const SERVICE = "neurorvu";

/** Never throws: a logger that can fail the request is worse than no logger. */
function describeCause(cause: unknown): { name?: string; message?: string; stack?: string } | undefined {
  if (cause == null) return undefined;
  if (cause instanceof Error) {
    return { name: cause.name, message: cause.message, stack: cause.stack };
  }
  try {
    return { message: JSON.stringify(cause) };
  } catch {
    return { message: Object.prototype.toString.call(cause) };
  }
}

/** POST the line to the monitoring destination, if one is configured. */
function shipToMonitor(line: string): void {
  const url = process.env.ERROR_MONITOR_URL;
  if (!url) return;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = process.env.ERROR_MONITOR_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    void fetch(url, { method: "POST", headers, body: line, keepalive: true }).catch((shipErr) => {
      // Do not recurse through logServerError — one line, no monitor hop.
      console.warn(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "warn",
          service: SERVICE,
          code: "monitor_ship_failed",
          cause: describeCause(shipErr),
        }),
      );
    });
  } catch (shipErr) {
    console.warn(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "warn",
        service: SERVICE,
        code: "monitor_ship_failed",
        cause: describeCause(shipErr),
      }),
    );
  }
}

/** Emit one structured line and ship it. Returns the line (handy for tests). */
export function logServerEvent(level: LogLevel, event: ServerLogEvent): string {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    service: SERVICE,
    route: event.route,
    correlationId: event.correlationId,
    code: event.code,
    status: event.status,
    ...(event.message ? { message: event.message } : {}),
    ...(event.cause !== undefined ? { cause: describeCause(event.cause) } : {}),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
  shipToMonitor(line);
  return line;
}

/** Convenience wrapper for the failure path. */
export function logServerError(event: ServerLogEvent): string {
  return logServerEvent("error", event);
}
