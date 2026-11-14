import { type } from "arktype";
import { ApiError, request } from "../api/http";

const ExplainBlocker = type({
  check: "string",
  evidence: "string",
  unblock: "string",
  "+": "delete",
});

const NextChange = type({
  action: "string",
  head: "string",
  "deployed?": "string | null",
  "+": "delete",
});

const ExplainReport = type({
  environment: "string",
  instance: "string",
  blockers: ExplainBlocker.array(),
  "next_change?": NextChange,
  "+": "delete",
});

export type ExplainBlocker = typeof ExplainBlocker.infer;
export type ExplainReport = typeof ExplainReport.infer;

export type ExplainLoad =
  | { kind: "ok"; value: ExplainReport }
  | { kind: "unavailable" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string };

/** The check Tenkai names for a stored plan that execution admission would reject. */
export const STALE_PLAN_CHECK = "superseded_plan";

/** Parse a recorded or live report; `undefined` when it is not this contract. */
export const parseExplain = (raw: unknown): ExplainReport | undefined => {
  const value = ExplainReport(raw);
  return value instanceof type.errors ? undefined : value;
};

export const explainPath = (environment: string, instance: string): string =>
  `v1/environments/${encodeURIComponent(environment)}/instances/${encodeURIComponent(instance)}/explain`;

/**
 * Read what blocks one instance's next change, blockers in server order.
 * Older servers have no route (404/405); the browser never derives blockers.
 */
export const fetchExplain = async (
  environment: string,
  instance: string,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<ExplainLoad> => {
  let raw: unknown;
  try {
    raw = await request<unknown>(explainPath(environment, instance), { token }, fetcher);
  } catch (error) {
    if (!(error instanceof ApiError)) {
      return { kind: "error", message: "Could not load" };
    }
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
  }
  const value = parseExplain(raw);
  return value ? { kind: "ok", value } : { kind: "error", message: "Could not load" };
};

/** `upgrade 1.0.0 -> 1.1.0`, `install 1.1.0`, or `current 1.1.0`. */
export const nextChangeLine = (next: NonNullable<ExplainReport["next_change"]>): string => {
  const deployed = next.deployed?.trim() ?? "";
  return deployed === "" || deployed === next.head
    ? `${next.action} ${next.head}`
    : `${next.action} ${deployed} -> ${next.head}`;
};
