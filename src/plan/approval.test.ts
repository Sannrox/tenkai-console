import { describe, expect, it } from "vitest";
import type {
  EffectiveApprovalPolicy,
  EnvironmentPlanSummary,
  PlanApprovalView,
} from "../api/tenkai.gen";
import { approvalCopy, shownDigest } from "./approval";

const plan = (approval?: PlanApprovalView, digest?: string): EnvironmentPlanSummary => ({
  id: "tenkai:plan:1",
  state: "computed",
  created_at: 1,
  step_count: 1,
  ...(digest ? { digest } : {}),
  ...(approval ? { approval } : {}),
});

const auto: EffectiveApprovalPolicy = {
  configured: true,
  mode: "auto",
  require_human: [
    "downgrade or rollback",
    "skip_gates",
    "has_migration",
    "changes_identity_config",
  ],
};

describe("shownDigest", () => {
  it("uses inspect, and a session digest only for the same plan", () => {
    const local = { planId: "tenkai:plan:1", digest: "sha256:local" };
    expect(shownDigest(plan(undefined, "sha256:inspect"), local)).toBe("sha256:inspect");
    expect(shownDigest(plan(), local)).toBe("sha256:local");
    expect(
      shownDigest(plan(), { planId: "tenkai:plan:other", digest: "sha256:local" }),
    ).toBeUndefined();
    expect(shownDigest(plan())).toBeUndefined();
  });
});

describe("approvalCopy", () => {
  it("shows digest, policy vs person, the downgrade rule, and no staleness", () => {
    expect(
      approvalCopy(plan({ source: "policy", policy_provider: "builtin-auto" }, "sha256:abc"), auto),
    ).toEqual({
      digest: "sha256:abc",
      source: "policy · builtin-auto",
      human: "downgrade or rollback, skip_gates, has_migration, changes_identity_config",
      stale: "no",
    });
    expect(
      approvalCopy(
        plan({
          source: "required",
          reason: "downgrade or rollback requires a human-signed envelope",
        }),
        auto,
      ),
    ).toMatchObject({
      source: "needs a person",
      human: "downgrade or rollback requires a human-signed envelope",
      stale: "no",
    });
    expect(approvalCopy(plan({ source: "human", policy_provider: "ops@site" }), auto).source).toBe(
      "person · ops@site",
    );
  });

  it("names a stale or expired recorded approval", () => {
    expect(
      approvalCopy(
        plan({ source: "required", reason: "recorded human approval has expired" }),
        auto,
      ),
    ).toEqual({
      digest: "not returned",
      source: "needs a person",
      human: "downgrade or rollback, skip_gates, has_migration, changes_identity_config",
      stale: "recorded human approval has expired",
    });
    expect(
      approvalCopy(
        plan({
          source: "policy",
          policy_provider: "builtin-auto",
          reason: "stale automatic approval will refresh",
        }),
        auto,
      ).stale,
    ).toBe("stale automatic approval will refresh");
  });

  it("does not claim a human is unneeded when policy and approval are unknown", () => {
    expect(
      approvalCopy(plan(), undefined, { planId: "tenkai:plan:1", digest: "sha256:local" }),
    ).toEqual({
      digest: "sha256:local",
      source: "not reported",
      human: "not reported",
      stale: "no",
    });
    expect(
      approvalCopy(undefined, undefined, { planId: "tenkai:plan:1", digest: "sha256:local" }),
    ).toEqual({
      digest: "not returned",
      source: "not reported",
      human: "not reported",
      stale: "no",
    });
    expect(approvalCopy(plan({ source: "required" }), undefined).human).toBe("needs a person");
    expect(approvalCopy(plan({ source: "policy" }), undefined).human).toBe("not required");
  });
});
