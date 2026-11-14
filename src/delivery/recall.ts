import { type } from "arktype";
import { ApiError, request } from "../api/http";
import { failedLoad, type Load } from "./owners";

// One recorded recall (Tenkai #1275): `GET /v1/releases/{release}/recall`
// names the actor (a promotion policy and version, or a principal), the
// reason with the measured shares, the failing instances with their checks,
// the covering range, and every instance still running the release. Older
// servers only accept POST on that path and answer 405; a newer server
// answers 404 for a release that is not recalled.
//
// Since Tenkai #1287 a policy recall also carries the measured shares and the
// threshold they exceeded, and every recall reports `done` of `total`
// instances per environment. Recalls recorded before that omit the shares and
// count only current holders, so their `done` is always 0.

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
  "healthy_share?": "number",
  "failing_share?": "number",
  "failing_max_share?": "number",
  "removal_environments?": type({ environment: "string", done: "number", total: "number" }).array(),
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

/** A 0..1 share as a percent with at most one decimal, so 5.1% never reads as 5%. */
export const percent = (value: number): string => `${Number((value * 100).toFixed(1))}%`;

/**
 * A policy recall the server reads back without shares while it does report
 * per-environment removal: recorded before shares and the holder snapshot
 * existed, so its removal counts start at the current holders. An older
 * server reports neither field and is not this case.
 */
export const recordedBeforeMeasures = (view: RecallView): boolean =>
  view.policy_id !== undefined &&
  view.healthy_share === undefined &&
  view.failing_share === undefined &&
  view.removal_environments !== undefined;

/** The measured shares as one line, or undefined when the recall carries none. */
export const measuredShares = (view: RecallView): string | undefined => {
  const parts = [
    view.healthy_share !== undefined && `healthy ${percent(view.healthy_share)}`,
    view.failing_share !== undefined && `failing ${percent(view.failing_share)}`,
  ].filter(Boolean);
  return parts.length === 0 ? undefined : parts.join(" · ");
};

/**
 * One environment's removal: the instances still running the release and,
 * when the server counts them, `done` of `total`.
 */
export type RemovalRow = {
  environment: string;
  instances: string[];
  counts?: { done: number; total: number };
};

/**
 * Removal per environment: every counted environment in server order, then
 * any other environment with instances still running the release.
 */
export const removalByEnvironment = (view: RecallView): RemovalRow[] => {
  const rows = new Map<string, RemovalRow>();
  for (const { environment, done, total } of view.removal_environments ?? []) {
    rows.set(environment, { environment, instances: [], counts: { done, total } });
  }
  for (const entry of view.removal_progress ?? []) {
    if (entry.remaining) {
      const row = rows.get(entry.environment) ?? { environment: entry.environment, instances: [] };
      rows.set(entry.environment, { ...row, instances: [...row.instances, entry.instance] });
    }
  }
  return [...rows.values()];
};

/** `done` of `total` summed over the counted environments, undefined when none is counted. */
export const removalTotals = (rows: RemovalRow[]): { done: number; total: number } | undefined =>
  rows.some((row) => row.counts)
    ? rows.reduce(
        (sum, { counts }) => ({
          done: sum.done + (counts?.done ?? 0),
          total: sum.total + (counts?.total ?? 0),
        }),
        { done: 0, total: 0 },
      )
    : undefined;
