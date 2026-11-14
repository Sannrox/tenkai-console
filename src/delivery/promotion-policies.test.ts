import { describe, expect, it } from "vitest";
import type { ChannelPromotionPolicyStatus } from "../api/tenkai.gen";
import { evaluatesPolicies, promotionPolicies } from "./promotion-policies";

const row = (patch: Partial<ChannelPromotionPolicyStatus>): ChannelPromotionPolicyStatus => ({
  product: "api",
  target_channel: "stable",
  source_channel: "candidate",
  policy_id: "channel-promotion-policy:api/stable",
  policy_version: 1,
  paused: false,
  state: "soaking",
  ...patch,
});

describe("evaluatesPolicies", () => {
  it("reads the versioned capability and says unknown for an unreadable body", () => {
    expect(evaluatesPolicies({ capabilities: ["channel_promotion_policy:v1"] })).toBe(true);
    expect(evaluatesPolicies({ capabilities: ["shell_executor:v1"] })).toBe(false);
    expect(evaluatesPolicies(undefined)).toBeUndefined();
  });
});

describe("promotionPolicies", () => {
  // The server omits an empty list, so only the capability separates the two.
  it("tells no policy from an older server", () => {
    expect(promotionPolicies({}, true)).toEqual({ kind: "none" });
    expect(promotionPolicies({ promotion_policies: [] }, true)).toEqual({ kind: "none" });
    expect(promotionPolicies({}, false)).toEqual({ kind: "unavailable" });
  });

  it("keeps instances without evidence and sorts by product and target", () => {
    const load = promotionPolicies(
      {
        promotion_policies: [
          row({ product: "web", target_channel: "candidate" }),
          row({ target_channel: "stable", instances_without_evidence: ["edge-1"] }),
          row({ target_channel: "candidate" }),
        ],
      },
      true,
    );
    expect(load.kind === "ok" && load.rows.map((r) => `${r.product}/${r.target_channel}`)).toEqual([
      "api/candidate",
      "api/stable",
      "web/candidate",
    ]);
    expect(load.kind === "ok" && load.rows[1]?.instances_without_evidence).toEqual(["edge-1"]);
  });

  it("calls a malformed list unreadable rather than empty", () => {
    expect(promotionPolicies({ promotion_policies: [{ product: "api" }] }, true)).toEqual({
      kind: "unreadable",
    });
  });
});
