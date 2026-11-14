import { type } from "arktype";
import { ApiError, request } from "../api/http";
import { failedLoad, type Load } from "./owners";

// One recorded recall (Tenkai #1275): `GET /v1/releases/{release}/recall`
// names the actor (a promotion policy and version, or a principal), the
// reason with the measured shares, the failing instances with their checks,
// the covering range, and every instance still running the release. Older
// servers only accept POST on that path and answer 405; a newer server
// answers 404 for a release that is not recalled.

const Removal = type({
  environment: "string",
  instance: "string",
  deployed: "string",
  remaining: "boolean",
});

const RecallView = type({
  release: "string",
  covers_future: "boolean",
  "recalled_at?": "number",
  "recalled_by?": "string",
  "principal_kind?": "string",
  "reason?": "string",
  "policy_id?": "string",
  "policy_version?": "string",
  "failing_instances?": "string[]",
  "range?": "string",
  "removal_progress?": Removal.array(),
});

export type RecallView = typeof RecallView.infer;

export type RecallLoad = Load<RecallView> | { kind: "not-recalled" };

/** `v1/releases/{release}/recall`. */
export const recallPath = (release: string): string =>
  `v1/releases/${encodeURIComponent(release)}/recall`;

/** The recall read, never the server's raw text on failure. */
export const fetchRecall = async (
  release: string,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<RecallLoad> => {
  let raw: unknown;
  try {
    raw = await request<unknown>(recallPath(release), { token }, fetcher);
  } catch (error) {
    return error instanceof ApiError && error.status === 404
      ? { kind: "not-recalled" }
      : failedLoad(error);
  }
  const value = RecallView(raw);
  return value instanceof type.errors
    ? { kind: "error", message: "Could not load" }
    : { kind: "ok", value };
};

/** Who recalled: the policy and its version, or the principal. */
export const recallActor = (view: RecallView): string =>
  view.policy_id === undefined
    ? (view.recalled_by ?? "unknown")
    : `policy ${view.policy_id}${view.policy_version === undefined ? "" : ` v${view.policy_version}`}`;

/**
 * What the recall covers. Without a range it is this release only; a range
 * with no upper bound also covers every future publish of the product.
 */
export const recallRange = (view: RecallView): { text: string; future: boolean } =>
  view.range === undefined
    ? { text: "this release only", future: false }
    : view.covers_future
      ? { text: `${view.range} · open, covers future releases`, future: true }
      : { text: `${view.range} · closed`, future: false };

export type RemovalRow = { environment: string; instances: string[] };

/** Instances still running the release, grouped per environment in server order. */
export const removalByEnvironment = (view: RecallView): RemovalRow[] => {
  const rows = new Map<string, string[]>();
  for (const entry of view.removal_progress ?? []) {
    if (entry.remaining) {
      rows.set(entry.environment, [...(rows.get(entry.environment) ?? []), entry.instance]);
    }
  }
  return [...rows].map(([environment, instances]) => ({ environment, instances }));
};
