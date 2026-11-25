import type { Pool } from "pg";

export type RequestTrafficClass =
  | "customer_value"
  | "polling"
  | "background"
  | "health_check"
  | "internal"
  | "other";

export type RequestFailureClass =
  | "success"
  | "expected_lifecycle"
  | "client_misuse"
  | "auth"
  | "rate_limit"
  | "not_found"
  | "conflict"
  | "timeout"
  | "dependency"
  | "internal_server"
  | "client_error";

export type RequestTelemetrySample = {
  route: string;
  method: string;
  trafficClass: RequestTrafficClass;
  statusCode: number;
  durationMs: number;
  occurredAt?: Date;
};

export type RequestTelemetryRow = {
  bucketStart: Date;
  route: string;
  method: string;
  trafficClass: RequestTrafficClass;
  requestCount: number;
  errorCount: number;
  totalDurationMs: number;
  durationLe50: number;
  durationLe100: number;
  durationLe250: number;
  durationLe500: number;
  durationLe1000: number;
  durationLe2000: number;
  durationLe5000: number;
  durationGt5000: number;
  statusCounts: Record<string, number>;
  lastSeenAt: Date;
};

const HOUR_MS = 60 * 60 * 1_000;
const MAX_BUFFERED_DIMENSIONS = 2_000;

export function normalizeRequestRoute(path: string): string {
  const cleanPath = path.split("?", 1)[0] || "/";
  const widgetPath = cleanPath.match(/^\/api\/v1\/widget\/[^/]+(\/.*)?$/);
  if (widgetPath) {
    return `/api/v1/widget/:siteKey${replaceIdentifiers(widgetPath[1] ?? "")}`;
  }

  const demoPath = cleanPath.match(/^\/api\/v1\/demo\/[^/]+(\/.*)?$/);
  if (demoPath) {
    return `/api/v1/demo/:slug${replaceIdentifiers(demoPath[1] ?? "")}`;
  }

  return replaceIdentifiers(cleanPath);
}

function replaceIdentifiers(path: string): string {
  return path
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, ":id")
    .replace(/\/\d+(?=\/|$)/g, "/:id")
    .replace(/\/([A-Za-z0-9_-]{32,})(?=\/|$)/g, "/:id");
}

export function classifyRequestTraffic(path: string, method: string): RequestTrafficClass {
  const cleanPath = path.split("?", 1)[0] || "/";
  const normalizedMethod = method.toUpperCase();
  if (cleanPath === "/health" || cleanPath === "/ready") return "health_check";
  if (cleanPath.startsWith("/api/v1/admin/") || cleanPath.startsWith("/api/v1/stripe/") || cleanPath.startsWith("/api/v1/webhooks/")) return "internal";
  if (
    normalizedMethod === "GET"
    && (/\/status$/.test(cleanPath)
      || /\/notifications(?:\/|$)/.test(cleanPath)
      || /\/inbox(?:\/|$)/.test(cleanPath)
      || /\/push\/config$/.test(cleanPath))
  ) return "polling";
  if (
    cleanPath.endsWith("/telemetry")
    || cleanPath.endsWith("/performance")
    || cleanPath.startsWith("/api/v1/auth/")
  ) return "background";
  if (
    cleanPath.includes("/conversations")
    || cleanPath.includes("/leads")
    || cleanPath.includes("/billing")
    || cleanPath.includes("/partners/")
    || cleanPath.startsWith("/api/v1/demos")
    || cleanPath.startsWith("/api/v1/demo-requests")
  ) return "customer_value";
  return "other";
}

function bucketStartFor(date: Date): Date {
  return new Date(Math.floor(date.getTime() / HOUR_MS) * HOUR_MS);
}

function emptyRow(input: RequestTelemetrySample, occurredAt: Date): RequestTelemetryRow {
  return {
    bucketStart: bucketStartFor(occurredAt),
    route: normalizeRequestRoute(input.route),
    method: input.method.toUpperCase(),
    trafficClass: input.trafficClass,
    requestCount: 0,
    errorCount: 0,
    totalDurationMs: 0,
    durationLe50: 0,
    durationLe100: 0,
    durationLe250: 0,
    durationLe500: 0,
    durationLe1000: 0,
    durationLe2000: 0,
    durationLe5000: 0,
    durationGt5000: 0,
    statusCounts: {},
    lastSeenAt: occurredAt,
  };
}

export function requestFailureClass(statusCode: number, trafficClass?: RequestTrafficClass): RequestFailureClass {
  if (statusCode < 400) return "success";
  if (trafficClass === "polling" && (statusCode === 404 || statusCode === 410)) return "expected_lifecycle";
  if (statusCode === 400 || statusCode === 422) return "client_misuse";
  if (statusCode === 401 || statusCode === 403) return "auth";
  if (statusCode === 404 || statusCode === 410) return "not_found";
  if (statusCode === 408 || statusCode === 504) return "timeout";
  if (statusCode === 409) return "conflict";
  if (statusCode === 429) return "rate_limit";
  if (statusCode === 502 || statusCode === 503) return "dependency";
  if (statusCode >= 500) return "internal_server";
  return "client_error";
}

function rowKey(row: Pick<RequestTelemetryRow, "bucketStart" | "route" | "method" | "trafficClass">): string {
  return `${row.bucketStart.toISOString()}|${row.route}|${row.method}|${row.trafficClass}`;
}

function addDuration(row: RequestTelemetryRow, durationMs: number): void {
  const safeDuration = Math.max(0, Math.round(Number.isFinite(durationMs) ? durationMs : 0));
  row.totalDurationMs += safeDuration;
  if (safeDuration <= 50) row.durationLe50 += 1;
  else if (safeDuration <= 100) row.durationLe100 += 1;
  else if (safeDuration <= 250) row.durationLe250 += 1;
  else if (safeDuration <= 500) row.durationLe500 += 1;
  else if (safeDuration <= 1_000) row.durationLe1000 += 1;
  else if (safeDuration <= 2_000) row.durationLe2000 += 1;
  else if (safeDuration <= 5_000) row.durationLe5000 += 1;
  else row.durationGt5000 += 1;
}

function mergeRows(target: RequestTelemetryRow, source: RequestTelemetryRow): void {
  target.requestCount += source.requestCount;
  target.errorCount += source.errorCount;
  target.totalDurationMs += source.totalDurationMs;
  target.durationLe50 += source.durationLe50;
  target.durationLe100 += source.durationLe100;
  target.durationLe250 += source.durationLe250;
  target.durationLe500 += source.durationLe500;
  target.durationLe1000 += source.durationLe1000;
  target.durationLe2000 += source.durationLe2000;
  target.durationLe5000 += source.durationLe5000;
  target.durationGt5000 += source.durationGt5000;
  for (const [statusCode, count] of Object.entries(source.statusCounts)) {
    target.statusCounts[statusCode] = (target.statusCounts[statusCode] ?? 0) + count;
  }
  if (source.lastSeenAt > target.lastSeenAt) target.lastSeenAt = source.lastSeenAt;
}

export class RequestTelemetryBuffer {
  private readonly rows = new Map<string, RequestTelemetryRow>();

  record(input: RequestTelemetrySample): void {
    const occurredAt = input.occurredAt ?? new Date();
    const row = emptyRow(input, occurredAt);
    const key = rowKey(row);
    const existing = this.rows.get(key);
    if (!existing && this.rows.size >= MAX_BUFFERED_DIMENSIONS) {
      const oldestKey = this.rows.keys().next().value;
      if (oldestKey) this.rows.delete(oldestKey);
    }
    const target = existing ?? row;
    target.requestCount += 1;
    if (input.statusCode >= 500) target.errorCount += 1;
    const statusCode = String(Math.max(100, Math.min(599, Math.round(input.statusCode))));
    target.statusCounts[statusCode] = (target.statusCounts[statusCode] ?? 0) + 1;
    addDuration(target, input.durationMs);
    if (occurredAt > target.lastSeenAt) target.lastSeenAt = occurredAt;
    this.rows.set(key, target);
  }

  snapshot(): RequestTelemetryRow[] {
    return [...this.rows.values()].map((row) => ({ ...row, statusCounts: { ...row.statusCounts } }));
  }

  drain(): RequestTelemetryRow[] {
    const rows = this.snapshot();
    this.rows.clear();
    return rows;
  }

  restore(rows: RequestTelemetryRow[]): void {
    for (const row of rows) {
      const key = rowKey(row);
      const existing = this.rows.get(key);
      if (existing) mergeRows(existing, row);
      else this.rows.set(key, { ...row });
    }
  }

  get size(): number {
    return this.rows.size;
  }
}

export async function persistRequestTelemetry(pool: Pool, rows: RequestTelemetryRow[]): Promise<void> {
  for (const row of rows) {
    await pool.query(
      `insert into api_request_metrics_hourly
         (bucket_start, route, method, traffic_class, request_count, error_count, total_duration_ms,
          duration_le_50, duration_le_100, duration_le_250, duration_le_500, duration_le_1000,
          duration_le_2000, duration_le_5000, duration_gt_5000, last_seen_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       on conflict (bucket_start, route, method, traffic_class) do update set
         request_count = api_request_metrics_hourly.request_count + excluded.request_count,
         error_count = api_request_metrics_hourly.error_count + excluded.error_count,
         total_duration_ms = api_request_metrics_hourly.total_duration_ms + excluded.total_duration_ms,
         duration_le_50 = api_request_metrics_hourly.duration_le_50 + excluded.duration_le_50,
         duration_le_100 = api_request_metrics_hourly.duration_le_100 + excluded.duration_le_100,
         duration_le_250 = api_request_metrics_hourly.duration_le_250 + excluded.duration_le_250,
         duration_le_500 = api_request_metrics_hourly.duration_le_500 + excluded.duration_le_500,
         duration_le_1000 = api_request_metrics_hourly.duration_le_1000 + excluded.duration_le_1000,
         duration_le_2000 = api_request_metrics_hourly.duration_le_2000 + excluded.duration_le_2000,
         duration_le_5000 = api_request_metrics_hourly.duration_le_5000 + excluded.duration_le_5000,
         duration_gt_5000 = api_request_metrics_hourly.duration_gt_5000 + excluded.duration_gt_5000,
         last_seen_at = greatest(api_request_metrics_hourly.last_seen_at, excluded.last_seen_at)`,
      [
        row.bucketStart,
        row.route,
        row.method,
        row.trafficClass,
        row.requestCount,
        row.errorCount,
        row.totalDurationMs,
        row.durationLe50,
        row.durationLe100,
        row.durationLe250,
        row.durationLe500,
        row.durationLe1000,
        row.durationLe2000,
        row.durationLe5000,
        row.durationGt5000,
        row.lastSeenAt,
      ],
    );
    for (const [statusCode, requestCount] of Object.entries(row.statusCounts)) {
      try {
        await pool.query(
          `insert into api_request_metrics_status_hourly
             (bucket_start, route, method, traffic_class, status_code, request_count)
           values ($1, $2, $3, $4, $5, $6)
           on conflict (bucket_start, route, method, traffic_class, status_code) do update set
             request_count = api_request_metrics_status_hourly.request_count + excluded.request_count`,
          [row.bucketStart, row.route, row.method, row.trafficClass, Number(statusCode), requestCount],
        );
      } catch (error) {
        // Keep the main request ledger usable during a rolling deploy before
        // the optional status-dimension migration has reached this instance.
        if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "42P01") break;
        throw error;
      }
    }
  }
}
