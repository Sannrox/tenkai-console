import { type } from "arktype";
import { ApiError, request } from "../api/http";
import type { ChannelPolicyPauseRequest } from "../api/tenkai.gen";
import { ageMs } from "./exposure";
import { failedLoad, type Load } from "./owners";

// `FleetStatusReport.promotion_policies` (Tenkai #899), read-only. The server
// omits the field when there are no policies, so an empty list and an older
// server look the same on `fleet/status`; the `channel_promotion_policy`
// runtime capability on `/healthz` tells them apart.

const PolicyStatus = type({
  product: "string",
  target_channel: "string",
  source_channel: "string",
  policy_id: "string",
  policy_version: "number",
  paused: "boolean",
  state: "string",
  "reason?": "string",
  "instances_without_evidence?": "string[]",
});

export type PolicyStatus = typeof PolicyStatus.infer;

export type PolicyLoad =
  | { kind: "ok"; rows: PolicyStatus[] }
  | { kind: "none" }
  | { kind: "unavailable" }
  | { kind: "unreadable" };

const CAPABILITY = "channel_promotion_policy";

/** Whether `/healthz` capabilities advertise policy evaluation; `undefined` when unknown. */
export const evaluatesPolicies = (health: unknown): boolean | undefined => {
  const capabilities = type({ capabilities: "string[]" })(health);
  if (capabilities instanceof type.errors) {
    return undefined;
  }
  return capabilities.capabilities.some(
    (name) => name === CAPABILITY || name.startsWith(`${CAPABILITY}:`),
  );
};

/**
 * Policy rows from a fleet report, sorted by product and target channel.
 * `capable` is `evaluatesPolicies` of the same server.
 */
export const promotionPolicies = (fleet: unknown, capable: boolean | undefined): PolicyLoad => {
  const raw =
    typeof fleet === "object" && fleet !== null && "promotion_policies" in fleet
      ? fleet.promotion_policies
      : undefined;
  if (raw === undefined || (Array.isArray(raw) && raw.length === 0)) {
    return capable === false ? { kind: "unavailable" } : { kind: "none" };
  }
  const rows = PolicyStatus.array()(raw);
  if (rows instanceof type.errors) {
    return { kind: "unreadable" };
  }
  return {
    kind: "ok",
    rows: rows.toSorted(
      (left, right) =>
        left.product.localeCompare(right.product) ||
        left.target_channel.localeCompare(right.target_channel),
    ),
  };
};

// One policy in detail (Tenkai #1271): `GET .../channels/{channel}/policy`
// for its rules, pause actor, and soak progress; pause and resume are
// catalog-wide management writes with no generation, so a repeat is a no-op.

const Evidence = type({
  "canary?": "boolean",
  "evaluation?": "boolean",
  "health_slo?": "boolean",
  "healthy_min_share?": "number",
  "failing_max_share?": "number",
  "recall_on_failing?": "boolean",
});

const PolicyView = type({
  product: "string",
  target_channel: "string",
  source_channel: "string",
  policy_id: "string",
  policy_version: "number",
  paused: "boolean",
  state: "string",
  soak_duration_ms: "number",
  evidence: Evidence,
  "reason?": "string",
  "paused_by?": "string",
  "paused_at?": "number",
  "soaking_release?": "string",
  "elapsed_ms?": "number",
  "healthy_share?": "number",
  "failing_share?": "number",
  "last_reset_at?": "number",
  "last_reset_cause?": "string",
  "promoted_by?": "string",
  "promoted_by_kind?": "string",
  "instances_without_evidence?": "string[]",
});

export type PolicyView = typeof PolicyView.infer;

/** `v1/products/{product}/channels/{channel}/policy`, plus `/pause` or `/resume`. */
export const policyPath = (product: string, channel: string, verb?: "pause" | "resume"): string =>
  `v1/products/${encodeURIComponent(product)}/channels/${encodeURIComponent(channel)}/policy${verb ? `/${verb}` : ""}`;

/** The detail read, never the server's raw text on failure. */
export const fetchPolicyView = async (
  product: string,
  channel: string,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<Load<PolicyView>> => {
  let raw: unknown;
  try {
    raw = await request<unknown>(policyPath(product, channel), { token }, fetcher);
  } catch (error) {
    return failedLoad(error);
  }
  const value = PolicyView(raw);
  return value instanceof type.errors
    ? { kind: "error", message: "Could not load" }
    : { kind: "ok", value };
};

/** Pause or resume body; the operation must match the route. */
export const pauseBody = (verb: "pause" | "resume"): ChannelPolicyPauseRequest => ({
  version: 1,
  operation: verb === "pause" ? "channel_policy_pause" : "channel_policy_resume",
});

/** What the soak must keep true, in the order the CLI declares it. */
export const evidenceLine = (evidence: PolicyView["evidence"]): string =>
  [
    evidence.health_slo && "health SLO",
    evidence.canary && "canary",
    evidence.evaluation && "evaluation",
    `healthy >= ${share(evidence.healthy_min_share ?? 1)}`,
    `failing <= ${share(evidence.failing_max_share ?? 0)}`,
  ]
    .filter(Boolean)
    .join(" · ");

/**
 * The recall rule: with `recall_on_failing`, a soak whose failing time share
 * exceeds `failing_max_share` recalls the soaking release instead of only
 * resetting the soak. Instances without health evidence never count.
 */
export const recallRule = (view: PolicyView): string =>
  view.evidence.recall_on_failing
    ? `when failing > ${share(view.evidence.failing_max_share ?? 0)} of ${ageMs(view.soak_duration_ms)} soak`
    : "off, a failing soak only resets";

/** A 0..1 time share as a whole percent. */
export const share = (value: number): string => `${Math.round(value * 100)}%`;

/** Elapsed against the minimum soak, as the server measured it. */
export const soakLine = (view: PolicyView): string =>
  `${view.elapsed_ms === undefined ? "?" : ageMs(view.elapsed_ms)} of ${ageMs(view.soak_duration_ms)}`;

/** The reset cause without the server's `reset:` tag. */
export const resetCause = (cause: string): string => cause.replace(/^reset:\s*/, "");

/** Minute-precision UTC time, as other console tables show it. */
export const at = (ms: number): string => `${new Date(ms).toISOString().slice(0, 16)}Z`;

/** Who made the current target head: the policy when it promoted, else the principal. */
export const promotedBy = (view: PolicyView): string | undefined =>
  view.promoted_by === undefined
    ? undefined
    : view.promoted_by_kind === "channel_promotion_policy"
      ? `policy ${view.promoted_by}`
      : view.promoted_by;

/**
 * What a pause or resume answer means. No answer, or a 5xx that may have
 * landed, is unknown; any refusal says so without the server's text.
 */
export const pauseOutcome = (
  verb: "pause" | "resume",
  error: unknown,
): { tone: "ok" | "bad" | "unknown"; text: string } => {
  if (error === undefined) {
    return { tone: "ok", text: verb === "pause" ? "Paused and audited." : "Resumed and audited." };
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
    return { tone: "bad", text: "This server cannot pause policies." };
  }
  return { tone: "bad", text: `${verb === "pause" ? "Pause" : "Resume"} refused.` };
};
