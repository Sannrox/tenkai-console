import { type } from "arktype";
import { ApiError, request } from "../api/http";
import { ageMs } from "./exposure";

// `GET /v1/environments/{environment}/delivery-report` (Tenkai #1083).
// Validated here rather than trusted as a generated type.
//
// Reuse decision
// Job: fetch a period-bounded recorded-performance summary for one environment
// and render each figure with its period and backing count, never treating
// missing records as zero or healthy, linking each figure to the attempt list.
// Verdict: Reuse
// Concept: GET-and-arktype load from `history.ts`; environment-detail section
// and Card/table from History; duration via `ageMs`; History links via
// `?environment&instance`.
// Edge: 404/405 older server; 403 no permission; missing_data hides zero rows;
// omitted optional fields are none, not 0; pin stays.
// Searched: DeliveryMetrics in the pin, history.ts, exposure ageMs, hold
// History link, CLI delivery report. Rejected: a new app; fleet N+1; boards.

const DeliveryMetrics = type({
  product: "string",
  "channel?": "string",
  deployments: "number",
  change_attempts: "number",
  change_failures: "number",
  "change_failure_rate?": "number",
  "lead_time_ms?": "number",
  restores: "number",
  unrestored: "number",
  "time_to_restore_ms?": "number",
  open_exposures: "number",
  "oldest_exposure_age_ms?": "number",
  "+": "delete",
});

const DeliveryReport = type({
  environment: "string",
  since_ms: "number",
  until_ms: "number",
  missing_data: "boolean",
  rows: DeliveryMetrics.array(),
  "+": "delete",
});

export type DeliveryMetrics = typeof DeliveryMetrics.infer;
export type DeliveryReport = typeof DeliveryReport.infer;

export type ReportLoad =
  | { kind: "ok"; value: DeliveryReport }
  | { kind: "unavailable" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string };

export type ReportQuery = {
  since_ms?: number;
  until_ms?: number;
};

export const DAY_MS = 86_400_000;
export const DEFAULT_PERIOD_DAYS = 30;
export const PERIOD_DAYS = [7, 30, 90] as const;

export const COPY = {
  unavailable: "This server does not report delivery metrics.",
  forbidden: "No access",
  missing: "missing data",
  empty: "none",
  loading: "Loading",
} as const;

/** 30 days is the server default, so that choice sends no query. */
export const reportQuery = (days: number, now: number): ReportQuery =>
  days === DEFAULT_PERIOD_DAYS ? {} : { since_ms: now - days * DAY_MS };

/** Path for one environment report. */
export const reportPath = (environment: string, query: ReportQuery = {}): string => {
  const params = new URLSearchParams();
  if (query.since_ms !== undefined) {
    params.set("since_ms", String(query.since_ms));
  }
  if (query.until_ms !== undefined) {
    params.set("until_ms", String(query.until_ms));
  }
  const qs = params.toString();
  const path = `v1/environments/${encodeURIComponent(environment)}/delivery-report`;
  return qs === "" ? path : `${path}?${qs}`;
};

/** Parse a recorded or live body; `undefined` when it is not this contract. */
export const parseReport = (raw: unknown): DeliveryReport | undefined => {
  const value = DeliveryReport(raw);
  return value instanceof type.errors ? undefined : value;
};

const visibleError = (error: ApiError): ReportLoad => {
  if (error.status === 404 || error.status === 405) {
    return { kind: "unavailable" };
  }
  if (error.status === 403) {
    return { kind: "forbidden" };
  }
  return {
    kind: "error",
    message: /HTTP \d{3}|\/v1\//.test(error.message) ? "Could not load" : error.message,
  };
};

/** Read one report. Older servers have no route. */
export const fetchReport = async (
  environment: string,
  token: string,
  query: ReportQuery = {},
  fetcher: typeof fetch = fetch,
): Promise<ReportLoad> => {
  let raw: unknown;
  try {
    raw = await request<unknown>(reportPath(environment, query), { token }, fetcher);
  } catch (error) {
    if (error instanceof ApiError) {
      return visibleError(error);
    }
    return { kind: "error", message: "Could not load" };
  }
  const value = parseReport(raw);
  return value ? { kind: "ok", value } : { kind: "error", message: "Could not load" };
};

/** Period the API echoed, as ISO-8601 instants. */
export const periodLine = (since_ms: number, until_ms: number): string =>
  `${new Date(since_ms).toISOString()} to ${new Date(until_ms).toISOString()}`;

export const channelLine = (channel: string | undefined): string => {
  const value = channel?.trim() ?? "";
  return value === "" ? COPY.empty : value;
};

export const rateLine = (rate: number): string => `${(rate * 100).toFixed(1)}%`;

export type Figure = {
  value: string;
  count: string;
};

/** Deployment count; 0 is a recorded count, not missing data. */
export const deployFigure = (row: DeliveryMetrics): Figure => ({
  value: String(row.deployments),
  count: `${row.deployments} records`,
});

/** Failure rate; absent without change attempts. */
export const failureFigure = (row: DeliveryMetrics): Figure | undefined => {
  if (row.change_failure_rate === undefined) {
    return undefined;
  }
  return {
    value: rateLine(row.change_failure_rate),
    count: `${row.change_failures} of ${row.change_attempts}`,
  };
};

/** Median lead time; absent without timed successful deploys. */
export const leadFigure = (row: DeliveryMetrics): Figure | undefined => {
  if (row.lead_time_ms === undefined) {
    return undefined;
  }
  return { value: ageMs(row.lead_time_ms), count: `${row.deployments} records` };
};

/** Median restore time and restore counts; absent without restores or open failures. */
export const restoreFigure = (row: DeliveryMetrics): Figure | undefined => {
  if (row.time_to_restore_ms === undefined && row.restores === 0 && row.unrestored === 0) {
    return undefined;
  }
  const restored = `${row.restores} restored · ${row.unrestored} unrestored`;
  if (row.time_to_restore_ms === undefined) {
    return { value: restored, count: restored };
  }
  return { value: ageMs(row.time_to_restore_ms), count: restored };
};

/** Oldest open exposure age; absent without open exposures. */
export const exposureFigure = (row: DeliveryMetrics): Figure | undefined => {
  if (row.oldest_exposure_age_ms === undefined) {
    return undefined;
  }
  return { value: ageMs(row.oldest_exposure_age_ms), count: `${row.open_exposures} open` };
};

/** History search for the attempts behind one product row. */
export const historySearch = (_environment: string, product: string) => ({
  instance: product,
});
