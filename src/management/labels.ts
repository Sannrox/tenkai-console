import { type } from "arktype";
import { ApiError, request } from "../api/http";
import type { ReleaseLabelRequest } from "../api/tenkai.gen";

/**
 * Environment and release labels (Sannrox/tenkai#1065, #1318). Reads are
 * `GET .../labels`, a map of `LabelView` or the older string values. History
 * is `GET .../labels/history`. Environment writes go through `configCall`
 * with `set_label`/`clear_label`; release writes carry no generation, so the
 * last write wins.
 *
 * Reuse decision
 * Job: show current named values with optional actor/time, and list recorded
 * set/clear events for one subject.
 * Verdict: Generalize
 * Concept: this module's GET-and-arktype load and `labelLine`; the existing
 * environment/release labels sections; history list markup from hold audit.
 * Edge: old string map vs LabelView; omitted set_by/set_at; history 404/405
 * as an older server. Credentials stay on the existing management call.
 * Searched: labels screens, hold audit, sealed-secrets set_by, webhook
 * delivery paging, environment history. Rejected: a new page or table;
 * paging (the contract is a bare array); hold's five-entry cap.
 */

const LabelView = type({
  value: "string",
  "set_by?": "string",
  "set_at?": "number",
  "+": "delete",
});

const LabelChange = type({
  action: "'set' | 'clear'",
  actor: "string",
  at: "number",
  id: "string",
  key: "string",
  "reason?": "string",
  sequence: "number",
  "value?": "string",
  "+": "delete",
});

const History = LabelChange.array();

export type LabelEntry = {
  key: string;
  value: string;
  set_by?: string;
  set_at?: number;
};

export type LabelChange = typeof LabelChange.infer;

type ReadFailure =
  | { kind: "unavailable" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string };

export type LabelsLoad = { kind: "ok"; labels: LabelEntry[] } | ReadFailure;
export type LabelHistoryLoad = { kind: "ok"; changes: LabelChange[] } | ReadFailure;

export const environmentLabelsPath = (environment: string): string =>
  `v1/environments/${encodeURIComponent(environment)}/labels`;

/** `product@version` as `v1/releases/{product}/{version}/labels`. */
export const releaseLabelsPath = (spec: string): string => {
  const [product = "", version = ""] = spec.split("@");
  return `v1/releases/${encodeURIComponent(product)}/${encodeURIComponent(version)}/labels`;
};

export const environmentLabelHistoryPath = (environment: string): string =>
  `${environmentLabelsPath(environment)}/history`;

export const releaseLabelHistoryPath = (spec: string): string =>
  `${releaseLabelsPath(spec)}/history`;

const failedRead = (error: unknown): ReadFailure => {
  if (!(error instanceof ApiError)) {
    return { kind: "error", message: "Could not load" };
  }
  if (error.status === 403) {
    return { kind: "forbidden" };
  }
  if (
    error.status === 405 ||
    (error.status === 404 && /^(HTTP 404|not found)$/.test(error.message))
  ) {
    return { kind: "unavailable" };
  }
  return {
    kind: "error",
    message: /HTTP \d{3}|\/v1\//.test(error.message) ? "Could not load" : error.message,
  };
};

const parseLabels = (raw: unknown): LabelEntry[] | undefined => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const labels: LabelEntry[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") {
      labels.push({ key, value });
      continue;
    }
    const view = LabelView(value);
    if (view instanceof type.errors) {
      return undefined;
    }
    labels.push({
      key,
      value: view.value,
      ...(view.set_by === undefined ? {} : { set_by: view.set_by }),
      ...(view.set_at === undefined ? {} : { set_at: view.set_at }),
    });
  }
  return labels.toSorted((left, right) => left.key.localeCompare(right.key));
};

/**
 * Read one label map, sorted by key. Accepts the current `LabelView` map and
 * the older string map. 403 is no permission; 405, or a bare 404 from a
 * server without the route, is unavailable. Any other refusal, such as an
 * unpublished release, shows the server's message.
 */
export const fetchLabels = async (
  path: string,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<LabelsLoad> => {
  let raw: unknown;
  try {
    raw = await request<unknown>(path, { token }, fetcher);
  } catch (error) {
    return failedRead(error);
  }
  const labels = parseLabels(raw);
  return labels === undefined
    ? { kind: "error", message: "Could not load" }
    : { kind: "ok", labels };
};

/**
 * Read recorded set and clear events, newest first. Same refusals as
 * `fetchLabels`; an older server has no history route.
 */
export const fetchLabelHistory = async (
  path: string,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<LabelHistoryLoad> => {
  let raw: unknown;
  try {
    raw = await request<unknown>(path, { token }, fetcher);
  } catch (error) {
    return failedRead(error);
  }
  const changes = History(raw);
  return changes instanceof type.errors
    ? { kind: "error", message: "Could not load" }
    : {
        kind: "ok",
        changes: changes.toSorted(
          (left, right) =>
            right.at - left.at || right.sequence - left.sequence || left.id.localeCompare(right.id),
        ),
      };
};

/** `PUT` sets `key=value`; `DELETE` (no value) clears `key`. */
export const releaseLabelCall = (
  spec: string,
  reason: string,
  key: string,
  value?: string,
): { method: "PUT" | "DELETE"; path: string; body: ReleaseLabelRequest } => ({
  method: value === undefined ? "DELETE" : "PUT",
  path: releaseLabelsPath(spec),
  body: {
    version: 1,
    operation: value === undefined ? "release_label_clear" : "release_label_set",
    key: key.trim(),
    ...(value === undefined ? {} : { value: value.trim() }),
    reason: reason.trim(),
  },
});

/** `key=value`, plus actor and time when the read carries them. */
const labelText = (label: LabelEntry): string => {
  const pair = `${label.key}=${label.value}`;
  const when = label.set_at === undefined ? undefined : new Date(label.set_at).toISOString();
  if (label.set_by !== undefined && when !== undefined) {
    return `${pair}, ${label.set_by} at ${when}`;
  }
  if (label.set_by !== undefined) {
    return `${pair}, ${label.set_by}`;
  }
  return when === undefined ? pair : `${pair}, ${when}`;
};

/** `a=1 · b=2`, or `none`. Provenance follows each value when present. */
export const labelLine = (labels: LabelEntry[]): string =>
  labels.length === 0 ? "none" : labels.map(labelText).join(" · ");

/** One history row: action, key (and value on set), actor, time, reason. */
export const historyLine = (change: LabelChange): string => {
  const what =
    change.action === "set" && change.value !== undefined
      ? `${change.key}=${change.value}`
      : change.key;
  const reason = change.reason === undefined || change.reason === "" ? "" : `: ${change.reason}`;
  return `${change.action} ${what} by ${change.actor} at ${new Date(change.at).toISOString()}${reason}`;
};
