import { type } from "arktype";
import { ApiError, request } from "../api/http";
import type { ReleaseLabelRequest } from "../api/tenkai.gen";

/**
 * Environment and release labels (Sannrox/tenkai#1065). Reads are
 * `GET .../labels`, a flat key to value map. Environment writes go through
 * `configCall` with `set_label`/`clear_label`; release writes carry no
 * generation, so the last write wins.
 */

const Labels = type({ "[string]": "string" });

export type LabelsLoad =
  | { kind: "ok"; labels: [key: string, value: string][] }
  | { kind: "unavailable" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string };

export const environmentLabelsPath = (environment: string): string =>
  `v1/environments/${encodeURIComponent(environment)}/labels`;

/** `product@version` as `v1/releases/{product}/{version}/labels`. */
export const releaseLabelsPath = (spec: string): string => {
  const [product = "", version = ""] = spec.split("@");
  return `v1/releases/${encodeURIComponent(product)}/${encodeURIComponent(version)}/labels`;
};

/**
 * Read one label map, sorted by key. 403 is no permission; 405, or a bare
 * 404 from a server without the route, is unavailable. Any other refusal,
 * such as an unpublished release, shows the server's message.
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
  }
  const labels = Labels(raw);
  return labels instanceof type.errors
    ? { kind: "error", message: "Could not load" }
    : { kind: "ok", labels: Object.entries(labels).toSorted(([a], [b]) => a.localeCompare(b)) };
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

/** `a=1 · b=2`, or `none`. */
export const labelLine = (labels: [string, string][]): string =>
  labels.length === 0 ? "none" : labels.map(([key, value]) => `${key}=${value}`).join(" · ");
