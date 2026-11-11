import { type } from "arktype";
import { ApiError, request } from "../api/http";

// `GET /v1/environments/{environment}/history` (Tenkai #1054 / #1055).
// The pinned contract predates the route and cause fields, so the response
// is validated here rather than trusted as a generated type.
//
// Reuse decision
// Job: list recorded deployment attempts for one environment, newest first,
// with structured failure cause when present and detail as the legacy fallback.
// Verdict: Generalize
// Concept: the GET-and-arktype load used by `dependencies.ts`; environment
// inspect stays the selected-row owner; cursor paging follows `v1/channels`;
// cause/restore overlay the same attempt row as extra inspect fields do.
// Edge: 404/405 is an older server (unavailable); omitted cause is a legacy
// attempt; malformed cause is dropped, detail remains; raw stays off the
// collapsed row; pin stays.
// Searched: spec_drift overlay parse, DeploymentAttemptView.cause/restore,
// inspect latest_failures, detail expand. Rejected: pin bump; parsing
// detail prose; a second history table.

const DeploymentCause = type({
  phase: "string",
  kind: "string",
  summary: "string",
  "raw?": "string",
  "truncated?": "boolean",
  "+": "delete",
});

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
  "+": "delete",
});

const DeploymentHistoryPage = type({
  items: DeploymentAttempt.array(),
  "next_cursor?": "string",
});

export type AttemptCause = typeof DeploymentCause.infer;
export type DeploymentAttempt = typeof DeploymentAttempt.infer & {
  cause?: AttemptCause;
  restore?: AttemptCause;
};
export type DeploymentHistoryPage = {
  items: DeploymentAttempt[];
  next_cursor?: string;
};

export type HistoryLoad =
  | { kind: "ok"; value: DeploymentHistoryPage }
  | { kind: "unavailable" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string };

export const PAGE_SIZE = 50;

/** Parse a recorded cause; `undefined` when omitted or not this contract. */
export const parseCause = (raw: unknown): AttemptCause | undefined => {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  const value = DeploymentCause(raw);
  return value instanceof type.errors ? undefined : value;
};

const withCauses = (page: DeploymentHistoryPage, raw: unknown): DeploymentHistoryPage => {
  if (typeof raw !== "object" || raw === null || !("items" in raw)) {
    return page;
  }
  const sources = raw.items;
  if (!Array.isArray(sources)) {
    return page;
  }
  return {
    ...page,
    items: page.items.map((item, index) => {
      const source = sources[index];
      if (typeof source !== "object" || source === null) {
        return item;
      }
      const cause = "cause" in source ? parseCause(source.cause) : undefined;
      const restore = "restore" in source ? parseCause(source.restore) : undefined;
      return {
        ...item,
        ...(cause === undefined ? {} : { cause }),
        ...(restore === undefined ? {} : { restore }),
      };
    }),
  };
};

/** Parse a recorded or live page; `undefined` when it is not this contract. */
export const parseHistory = (raw: unknown): DeploymentHistoryPage | undefined => {
  const value = DeploymentHistoryPage(raw);
  return value instanceof type.errors ? undefined : withCauses(value, raw);
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

/** Phase and kind for the collapsed row; empty parts drop out. */
export const causeLine = (cause: AttemptCause): string => {
  const phase = cause.phase.trim();
  const kind = cause.kind.trim();
  if (phase === "" && kind === "") {
    return "·";
  }
  if (phase === "") {
    return kind;
  }
  if (kind === "") {
    return phase;
  }
  return `${phase} · ${kind}`;
};

export const causeSummary = (cause: AttemptCause): string => {
  const summary = cause.summary.trim();
  return summary === "" ? "none" : summary;
};

export const causeRaw = (cause: AttemptCause | undefined): string => cause?.raw?.trim() ?? "";

export const causeTruncated = (cause: AttemptCause | undefined): boolean =>
  cause?.truncated === true;

/** Restore that did not put the previous release back. */
export const restoreFailed = (restore: AttemptCause | undefined): boolean =>
  restore !== undefined &&
  (restore.kind === "restore_failed" || restore.kind === "host_not_restored");

const PREVIEW = 80;

/** First line, cut to `PREVIEW` characters, for a collapsed detail cell. */
export const detailPreview = (detail: string): string => {
  const line = detail.split("\n", 1)[0] ?? "";
  return line.length <= PREVIEW ? line : `${line.slice(0, PREVIEW)}...`;
};

/** True when the cell must expand to show the stored detail. */
export const detailNeedsExpand = (detail: string): boolean =>
  detail.includes("\n") || detail.length > PREVIEW;
