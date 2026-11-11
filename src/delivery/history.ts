import { type } from "arktype";
import { ApiError, request } from "../api/http";

// `GET /v1/environments/{environment}/history` (Tenkai #1054).
// The pinned contract predates the route, so the response is validated here
// rather than trusted as a generated type.
//
// Reuse decision
// Job: list recorded deployment attempts for one environment, newest first,
// with an optional instance filter and cursor paging.
// Verdict: Generalize
// Concept: the GET-and-arktype load used by `dependencies.ts`; environment
// inspect stays the selected-row owner; cursor paging follows `v1/channels`.
// Edge: 404/405 is an older server (unavailable); paging uses only
// `next_cursor` so a later attempt does not reshuffle a page already shown.
// Searched: environment inspect, dependencies fetch, channel pages, failed-
// target hold, plan page. Rejected: pin bump; structured cause (#113).

const DeploymentAttempt = type({
  id: "string",
  created_at: "number",
  instance: "string",
  product: "string",
  to_version: "string",
  status: "string",
  "action?": "string",
  "detail?": "string",
  "from_version?": "string | null",
  "plan_id?": "string",
});

const DeploymentHistoryPage = type({
  items: DeploymentAttempt.array(),
  "next_cursor?": "string",
});

export type DeploymentAttempt = typeof DeploymentAttempt.infer;
export type DeploymentHistoryPage = typeof DeploymentHistoryPage.infer;

export type HistoryLoad =
  | { kind: "ok"; value: DeploymentHistoryPage }
  | { kind: "unavailable" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string };

export const PAGE_SIZE = 50;

/** Parse a recorded or live page; `undefined` when it is not this contract. */
export const parseHistory = (raw: unknown): DeploymentHistoryPage | undefined => {
  const value = DeploymentHistoryPage(raw);
  return value instanceof type.errors ? undefined : value;
};

export type HistoryQuery = {
  instance?: string;
  cursor?: string;
};

/** Path for one history page. `product` is the instance name on the server. */
export const historyPath = (environment: string, query: HistoryQuery = {}): string => {
  const params = new URLSearchParams();
  params.set("limit", String(PAGE_SIZE));
  const instance = query.instance?.trim() ?? "";
  if (instance !== "") {
    params.set("product", instance);
  }
  const cursor = query.cursor?.trim() ?? "";
  if (cursor !== "") {
    params.set("cursor", cursor);
  }
  return `v1/environments/${encodeURIComponent(environment)}/history?${params}`;
};

const visibleError = (error: ApiError): HistoryLoad => {
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

/** Read one page. Older servers have no route. */
export const fetchHistory = async (
  environment: string,
  token: string,
  query: HistoryQuery = {},
  fetcher: typeof fetch = fetch,
): Promise<HistoryLoad> => {
  let raw: unknown;
  try {
    raw = await request<unknown>(historyPath(environment, query), { token }, fetcher);
  } catch (error) {
    if (error instanceof ApiError) {
      return visibleError(error);
    }
    return { kind: "error", message: "Could not load" };
  }
  const value = parseHistory(raw);
  return value ? { kind: "ok", value } : { kind: "error", message: "Could not load" };
};

/** Cursor for the next page; empty is the end. */
export const nextCursor = (page: DeploymentHistoryPage): string | undefined => {
  const cursor = page.next_cursor?.trim() ?? "";
  return cursor === "" ? undefined : cursor;
};

/** Instant the API stored the attempt, as ISO-8601. */
export const attemptTime = (ms: number): string => new Date(ms).toISOString();

/** From -> to as the API reports them; missing from is `none`. */
export const versionLine = (attempt: DeploymentAttempt): string => {
  const from = attempt.from_version?.trim() ?? "";
  return `${from === "" ? "none" : from} -> ${attempt.to_version}`;
};

export const attemptAction = (attempt: DeploymentAttempt): string => {
  const action = attempt.action?.trim() ?? "";
  return action === "" ? "none" : action;
};

export const attemptPlan = (attempt: DeploymentAttempt): string => {
  const plan = attempt.plan_id?.trim() ?? "";
  return plan === "" ? "none" : plan;
};

export const attemptDetail = (attempt: DeploymentAttempt): string => attempt.detail ?? "";

const PREVIEW = 80;

/** First line, cut to `PREVIEW` characters, for a collapsed detail cell. */
export const detailPreview = (detail: string): string => {
  const line = detail.split("\n", 1)[0] ?? "";
  return line.length <= PREVIEW ? line : `${line.slice(0, PREVIEW)}...`;
};

/** True when the cell must expand to show the stored detail. */
export const detailNeedsExpand = (detail: string): boolean =>
  detail.includes("\n") || detail.length > PREVIEW;
