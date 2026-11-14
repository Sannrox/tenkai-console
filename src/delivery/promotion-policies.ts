import { type } from "arktype";
import { ApiError, request } from "../api/http";
import type { ChannelPolicyPauseRequest, ChannelRecallRuleRequest } from "../api/tenkai.gen";
import { ageMs } from "./exposure";
import { graceWindow } from "./grace";
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

// Recall rule write (Tenkai #1287): `PUT .../channels/{channel}/policy`
// replaces soak, failing threshold, and recall-on-failing, keeping the rest of
// the policy and its pause. It is fenced by the policy version the operator
// read; another version is refused with 409, never merged.

export type RecallRuleInput = { soak: string; failingMax: string; recall: boolean };

export type RecallRule = Pick<
  ChannelRecallRuleRequest,
  "soak_duration_ms" | "failing_max_share" | "recall_on_failing"
>;

const SOAK = /^(\d+)(ms|d|h|m|s)$/;
const SHARE = /^(?:\d+\.?\d*|\.\d+)$/;
const SOAK_UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** The form's starting values: the rule as the policy holds it now. */
export const recallRuleInput = (view: PolicyView): RecallRuleInput => ({
  soak: graceWindow(view.soak_duration_ms),
  failingMax: String(view.evidence.failing_max_share ?? 0),
  recall: view.evidence.recall_on_failing === true,
});

/**
 * The rule to send, or undefined when its shape is wrong: a whole duration
 * with a unit (`90m`, `1h`) and a share from 0 to 1. Whether the values are
 * acceptable is the server's call.
 */
export const parseRecallRule = (input: RecallRuleInput): RecallRule | undefined => {
  const soak = SOAK.exec(input.soak.trim());
  const failingText = input.failingMax.trim();
  const failing = SHARE.test(failingText) ? Number(failingText) : Number.NaN;
  const size = SOAK_UNIT_MS[soak?.[2] ?? ""];
  if (!soak?.[1] || size === undefined || !(failing >= 0 && failing <= 1)) {
    return undefined;
  }
  const ms = Number(soak[1]) * size;
  return Number.isSafeInteger(ms)
    ? { soak_duration_ms: ms, failing_max_share: failing, recall_on_failing: input.recall }
    : undefined;
};

/** The PUT body, fenced by the policy version the operator read. */
export const recallRuleBody = (
  policyVersion: number,
  rule: RecallRule,
): ChannelRecallRuleRequest => ({
  version: 1,
  operation: "channel_configure",
  expected_generation: policyVersion,
  ...rule,
});

/** The rule as the confirmation names it, so the confirmation is the preview. */
export const recallRuleLine = (rule: RecallRule): string =>
  `soak ${graceWindow(rule.soak_duration_ms)}, ${rule.recall_on_failing ? "recall" : "reset only"} when failing > ${rule.failing_max_share}`;

/**
 * What a recall rule write answer means. No answer, or a 5xx that may have
 * landed, is unknown; 409 is a policy that changed since it was read, to be
 * reloaded and checked; other refusals say so without the server's text.
 */
export const recallRuleOutcome = (
  error: unknown,
): { tone: "ok" | "bad" | "unknown"; text: string; stale?: true } => {
  if (error === undefined) {
    return { tone: "ok", text: "Recall rule set and audited." };
  }
  if (!(error instanceof ApiError) || error.status >= 500) {
    return {
      tone: "unknown",
      text: "No answer from the server; the outcome is unknown until the next read.",
    };
  }
  if (error.status === 409) {
    return {
      tone: "bad",
      text: "The policy changed since you read it. Nothing was set; reload and check it.",
      stale: true,
    };
  }
  if (error.status === 403) {
    return { tone: "bad", text: "Not permitted." };
  }
  if (error.status === 404 || error.status === 405) {
    return { tone: "bad", text: "This server cannot edit the recall rule." };
  }
  return { tone: "bad", text: "Recall rule refused." };
};
