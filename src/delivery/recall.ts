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
//
// Limited removal (Tenkai #1546): `removal_scope` names the environments
// that roll off; omitted is fleet-wide, including recalls recorded before
// scoped removal. Do not invent fleet-wide from absence. `POST .../recall/widen`
// appends environments or covers the fleet; 405 is a refusal. Range
// exclusions (Tenkai #1547) are values from GET recall-ranges. An instance
// count (Tenkai #1548) is an optional threshold beside the share.

const Removal = type({
  environment: "string",
  instance: "string",
  deployed: "string",
  remaining: "boolean",
});

const OutOfScope = type({
  environment: "string",
  status: "string",
});

const Widening = type({
  fleet_wide: "boolean",
  principal_kind: "string",
  reason: "string",
  widened_at: "number",
  widened_by: "string",
  "environments?": "string[]",
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
  "failing_max_instances?": "number",
  "failing_instance_count?": "number",
  "removal_environments?": type({ environment: "string", done: "number", total: "number" }).array(),
  "removal_scope?": "string[]",
  "out_of_scope?": OutOfScope.array(),
  "widenings?": Widening.array(),
});

const RangeExclusion = type({
  actor: "string",
  reason: "string",
  recorded_at: "number",
  version: "string",
});

const RecallRange = type({
  actor: "string",
  covers_future: "boolean",
  from: "string",
  product: "string",
  reason: "string",
  recorded_at: "number",
  "before?": "string",
  "exclusions?": RangeExclusion.array(),
});

const RecallRangePage = type({
  items: RecallRange.array(),
});

export type RecallView = typeof RecallView.infer;
export type RecallRange = typeof RecallRange.infer;
export type RangeExclusion = typeof RangeExclusion.infer;
export type Widening = typeof Widening.infer;

export type RecallLoad = Load<RecallView> | { kind: "not-recalled" };

/** `v1/releases/{release}/recall`. */
export const recallPath = (release: string): string =>
  `v1/releases/${encodeURIComponent(release)}/recall`;

/** `v1/releases/{release}/recall/widen`. */
export const widenPath = (release: string): string => `${recallPath(release)}/widen`;

/** `v1/products/{product}/recall-ranges`. */
export const recallRangesPath = (product: string): string =>
  `v1/products/${encodeURIComponent(product)}/recall-ranges`;

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

/**
 * Recorded ranges for one product. A missing or older route, a refusal, or
 * an unreadable body is an empty list: exclusions stay omitted, and the
 * recall read is still the screen.
 */
export const fetchRecallRanges = async (
  product: string,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<RecallRange[]> => {
  let raw: unknown;
  try {
    raw = await request<unknown>(recallRangesPath(product), { token }, fetcher);
  } catch {
    return [];
  }
  const page = RecallRangePage(raw);
  return page instanceof type.errors ? [] : page.items;
};

/** Environments named in a widen field, comma or whitespace separated. */
export const parseEnvironments = (text: string): string[] =>
  text
    .split(/[,\s]+/)
    .map((name) => name.trim())
    .filter(Boolean);

/**
 * Body of POST recall/widen. The route's operation is still `recall`.
 * `fleetWide` and named environments are mutually exclusive.
 */
export const widenBody = (input: {
  reason: string;
  environments?: readonly string[];
  fleetWide?: boolean;
}): { version: 1; operation: "recall"; reason: string } & (
  | { fleet_wide: true }
  | { environments: string[] }
) =>
  input.fleetWide
    ? { version: 1, operation: "recall", reason: input.reason, fleet_wide: true }
    : {
        version: 1,
        operation: "recall",
        reason: input.reason,
        environments: [...(input.environments ?? [])],
      };

/**
 * What a widen answer means. No answer, or a 5xx that may have landed, is
 * unknown and is never retried. 405 is a refusal: this server cannot widen.
 */
export const widenOutcome = (error: unknown): { tone: "ok" | "bad" | "unknown"; text: string } => {
  if (error === undefined) {
    return { tone: "ok", text: "Removal widened and audited." };
  }
  if (!(error instanceof ApiError) || error.status >= 500) {
    return {
      tone: "unknown",
      text: "No answer from the server; the outcome is unknown until the next read.",
    };
  }
  if (error.status === 403) {
    return { tone: "bad", text: "Not permitted." };
  }
  if (error.status === 404 || error.status === 405) {
    return { tone: "bad", text: "This server cannot widen removal." };
  }
  return { tone: "bad", text: "Widen refused." };
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
 * Shares plus the threshold that fired, when the recall carries either.
 * Count and share are mutually exclusive on the recall: the server records
 * the one that reached first.
 */
export const measuredLine = (view: RecallView): string | undefined => {
  const shares = measuredShares(view);
  const threshold =
    view.failing_max_instances !== undefined
      ? `threshold ${view.failing_max_instances} ${view.failing_max_instances === 1 ? "instance" : "instances"}, reached`
      : view.failing_max_share !== undefined
        ? `failing > ${percent(view.failing_max_share)}, exceeded`
        : undefined;
  const parts = [shares, threshold].filter(Boolean);
  return parts.length === 0 ? undefined : parts.join(" · ");
};

/** Product and `from`/`before` as the recall read writes the range string. */
export const rangeKey = (range: Pick<RecallRange, "product" | "from" | "before">): string =>
  `${range.product} [${range.from}, ${range.before ?? "∞"})`;

/** Exclusions on the range that currently names this recall, or none. */
export const exclusionsFor = (
  view: RecallView,
  ranges: readonly RecallRange[],
): RangeExclusion[] => {
  if (view.range === undefined) {
    return [];
  }
  return ranges.find((range) => rangeKey(range) === view.range)?.exclusions ?? [];
};

/** Range plus exclusions as values, never as a write. */
export const rangeLine = (view: RecallView, exclusions: readonly RangeExclusion[]): string => {
  const range = recallRange(view);
  if (exclusions.length === 0) {
    return `Range ${range.text}`;
  }
  const listed = exclusions
    .map((item) => `${item.version} by ${item.actor} (${item.reason})`)
    .join(", ");
  return `Range ${range.text}, excluding ${listed}`;
};

/** One widening as the history line: who added which environments, or covered the fleet. */
export const wideningLine = (item: Widening): string => {
  const what = item.fleet_wide
    ? "covered the fleet"
    : `added ${(item.environments ?? []).join(", ")}`;
  return `${new Date(item.widened_at).toISOString().slice(0, 16)}Z ${item.widened_by} ${what} · ${item.reason}`;
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

/** Scope as the table shows it. Omitted when the recall does not carry a scope list. */
export type ScopeKind = "remove" | "keep";

export type EnvironmentRow = RemovalRow & { scope?: ScopeKind };

/**
 * One row per environment in the removal counts, still running, or out of
 * scope. `scope` is set only when the recall named a removal list: do not
 * invent fleet-wide from absence.
 */
export const environmentRows = (view: RecallView): EnvironmentRow[] => {
  const limited = view.removal_scope !== undefined;
  const rows = new Map<string, EnvironmentRow>();
  for (const row of removalByEnvironment(view)) {
    rows.set(row.environment, limited ? { ...row, scope: "remove" } : row);
  }
  for (const { environment } of view.out_of_scope ?? []) {
    const row = rows.get(environment) ?? { environment, instances: [] };
    rows.set(environment, { ...row, scope: "keep" });
  }
  return [...rows.values()];
};

/** Whether any row carries a scope value, so the column is shown. */
export const showsScope = (rows: readonly EnvironmentRow[]): boolean =>
  rows.some((row) => row.scope !== undefined);

/** In-scope environments that still run the release. */
export const remainingInScope = (rows: readonly EnvironmentRow[]): EnvironmentRow[] =>
  rows.filter((row) => row.scope !== "keep" && row.instances.length > 0);

/** Environments recalled with removal not in scope. */
export const keptEnvironments = (rows: readonly EnvironmentRow[]): string[] =>
  rows.filter((row) => row.scope === "keep").map((row) => row.environment);

/** Compact recall situation under the release tabs. */
export const recallBanner = (view: RecallView): string => {
  const rows = environmentRows(view);
  const removing = rows.filter((row) => row.scope !== "keep").map((row) => row.environment);
  const kept = keptEnvironments(rows);
  if (view.removal_scope !== undefined) {
    const removal =
      removing.length === 0
        ? "Limited removal."
        : `Limited removal. ${removing.join(", ")} in removal`;
    return kept.length === 0
      ? removing.length === 0
        ? removal
        : `${removal}.`
      : `${removal} · ${kept.join(", ")} keep.`;
  }
  if (removing.length === 0) {
    return "Fleet-wide removal.";
  }
  return `Fleet-wide removal. ${removing.length} ${removing.length === 1 ? "environment" : "environments"} in removal.`;
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
