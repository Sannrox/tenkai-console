import type {
  EffectiveApprovalPolicy,
  EnvironmentPlanSummary,
  PlanApprovalView,
} from "../api/tenkai.gen";

/** Operator-facing copy for one plan's digest, source, human rule, and staleness. */
export type ApprovalCopy = {
  digest: string;
  source: string;
  human: string;
  stale: string;
};

const SOURCE: Record<string, string> = {
  policy: "policy",
  human: "person",
  development: "development",
  required: "needs a person",
};

/** Digest from inspect, else this session's digest only when it belongs to this plan. */
export const shownDigest = (
  plan: EnvironmentPlanSummary | null | undefined,
  local?: { planId: string; digest: string },
): string | undefined =>
  plan?.digest ?? (local && plan?.id === local.planId ? local.digest : undefined);

const staleReason = (approval: PlanApprovalView | undefined): string | undefined => {
  const reason = approval?.reason;
  if (!reason) {
    return undefined;
  }
  return /stale|expired/i.test(reason) ? reason : undefined;
};

const standingRules = (policy: EffectiveApprovalPolicy | undefined): string | undefined => {
  const rules = policy?.require_human?.filter(Boolean) ?? [];
  return rules.length ? rules.join(", ") : undefined;
};

/**
 * Plan page rows: digest, policy vs person, why a human signature is required,
 * and whether a recorded approval went stale. The server owns the facts.
 */
export const approvalCopy = (
  plan: EnvironmentPlanSummary | null | undefined,
  policy: EffectiveApprovalPolicy | undefined,
  local?: { planId: string; digest: string },
): ApprovalCopy => {
  const approval = plan?.approval;
  const stale = staleReason(approval);
  const named = approval?.source ? (SOURCE[approval.source] ?? approval.source) : "not reported";
  const source = approval?.policy_provider ? `${named} · ${approval.policy_provider}` : named;
  const specific = approval?.reason && !stale ? approval.reason : undefined;
  const fallback =
    approval?.source === "required"
      ? "needs a person"
      : approval?.source
        ? "not required"
        : "not reported";
  return {
    digest: shownDigest(plan, local) ?? "not returned",
    source,
    human: specific ?? standingRules(policy) ?? fallback,
    stale: stale ?? "no",
  };
};
