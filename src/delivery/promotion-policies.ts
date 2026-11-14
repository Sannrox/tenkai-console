import { type } from "arktype";

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
