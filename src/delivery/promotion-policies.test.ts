import { describe, expect, it } from "vitest";
import { ApiError } from "../api/http";
import type { ChannelPromotionPolicyStatus, ChannelPromotionPolicyView } from "../api/tenkai.gen";
import {
  evaluatesPolicies,
  evidenceLine,
  fetchPolicyView,
  pauseBody,
  parseRecallRule,
  pauseOutcome,
  policyPath,
  promotedBy,
  promotionPolicies,
  recallRule,
  recallRuleBody,
  recallRuleInput,
  recallRuleLine,
  recallRuleOutcome,
  resetCause,
  soakLine,
} from "./promotion-policies";

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

const view = (patch: Partial<ChannelPromotionPolicyView>): ChannelPromotionPolicyView => ({
  product: "api",
  target_channel: "stable",
  source_channel: "candidate",
  policy_id: "channel-promotion-policy:api/stable",
  policy_version: 3,
  paused: false,
  state: "soaking",
  soak_duration_ms: 3_600_000,
  evidence: { health_slo: true, healthy_min_share: 0.95, failing_max_share: 0.05 },
  ...patch,
});

const answering =
  (status: number, body: unknown): typeof fetch =>
  () =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));

describe("fetchPolicyView", () => {
  it("reads the policy route with encoded segments", async () => {
    let url = "";
    const load = await fetchPolicyView("api", "a/b", "t", (input) => {
      url = input instanceof URL ? input.href : JSON.stringify(input);
      return Promise.resolve(new Response(JSON.stringify(view({}))));
    });
    expect(url).toMatch(/\/v1\/products\/api\/channels\/a%2Fb\/policy$/);
    expect(load.kind).toBe("ok");
  });

  // Older servers answer 404; a malformed body is not shown as a policy.
  it("never surfaces raw server text", async () => {
    expect(await fetchPolicyView("api", "stable", "t", answering(404, { error: "x" }))).toEqual({
      kind: "unavailable",
    });
    expect(await fetchPolicyView("api", "stable", "t", answering(403, { error: "x" }))).toEqual({
      kind: "forbidden",
    });
    expect(await fetchPolicyView("api", "stable", "t", answering(200, { product: "api" }))).toEqual(
      { kind: "error", message: "Could not load" },
    );
  });
});

describe("policy detail lines", () => {
  it("names the route's operation and the required evidence", () => {
    expect(policyPath("api", "stable", "resume")).toBe(
      "v1/products/api/channels/stable/policy/resume",
    );
    expect(pauseBody("pause")).toEqual({ version: 1, operation: "channel_policy_pause" });
    expect(pauseBody("resume")).toEqual({ version: 1, operation: "channel_policy_resume" });
    expect(evidenceLine(view({}).evidence)).toBe("health SLO · healthy >= 95% · failing <= 5%");
  });

  it("reads the recall rule from the evidence", () => {
    expect(recallRule(view({}))).toBe("off, a failing soak only resets");
    expect(
      recallRule(
        view({
          evidence: { failing_max_share: 0.05, recall_on_failing: true },
          soak_duration_ms: 3_600_000,
        }),
      ),
    ).toBe("when failing > 5% of 1h soak");
  });

  it("shows elapsed soak, the reset cause, and the policy as promoter", () => {
    expect(soakLine(view({ elapsed_ms: 720_000 }))).toBe("12m of 1h");
    expect(resetCause("reset: health evidence failed on edge-3")).toBe(
      "health evidence failed on edge-3",
    );
    expect(
      promotedBy(
        view({
          promoted_by: "channel-promotion-policy:api/stable",
          promoted_by_kind: "channel_promotion_policy",
        }),
      ),
    ).toBe("policy channel-promotion-policy:api/stable");
    expect(promotedBy(view({ promoted_by: "alice" }))).toBe("alice");
  });
});

describe("pauseOutcome", () => {
  it("reads a lost or 5xx answer as unknown and hides refusal text", () => {
    expect(pauseOutcome("pause", new TypeError("network")).tone).toBe("unknown");
    expect(pauseOutcome("pause", new ApiError(502, "HTTP 502")).tone).toBe("unknown");
    expect(pauseOutcome("pause", new ApiError(403, "secret detail"))).toEqual({
      tone: "bad",
      text: "Not permitted.",
    });
    expect(pauseOutcome("resume", new ApiError(409, "secret detail")).text).toBe("Resume refused.");
    expect(pauseOutcome("pause", undefined)).toEqual({ tone: "ok", text: "Paused and audited." });
  });
});

describe("recall rule edit", () => {
  it("starts from the rule the policy holds", () => {
    expect(recallRuleInput(view({}))).toEqual({ soak: "1h", failingMax: "0.05", recall: false });
    expect(
      recallRuleInput(view({ soak_duration_ms: 90_000, evidence: { recall_on_failing: true } })),
    ).toEqual({ soak: "90s", failingMax: "0", recall: true });
  });

  it("checks shape only: a whole duration with a unit and a share from 0 to 1", () => {
    const rule = (soak: string, failingMax: string) =>
      parseRecallRule({ soak, failingMax, recall: true });
    expect(rule(" 90m ", "0.1")).toEqual({
      soak_duration_ms: 5_400_000,
      failing_max_share: 0.1,
      recall_on_failing: true,
    });
    expect(rule("2d", "1")?.soak_duration_ms).toBe(172_800_000);
    expect(rule("0s", "0")?.soak_duration_ms).toBe(0);
    for (const [soak, share] of [
      ["1h", ""],
      ["1h", "1.5"],
      ["1h", "-0.1"],
      ["1h", "5%"],
      ["1h", "0x1"],
      ["1h", "1e-1"],
      ["1.5h", "0.1"],
      ["60", "0.1"],
      ["-1h", "0.1"],
      ["99999999999999999d", "0.1"],
    ]) {
      expect(rule(soak ?? "", share ?? "")).toBeUndefined();
    }
  });

  it("fences the body by the policy version read and previews it", () => {
    const rule = { soak_duration_ms: 3_600_000, failing_max_share: 0.05, recall_on_failing: true };
    expect(recallRuleBody(3, rule)).toEqual({
      version: 1,
      operation: "channel_configure",
      expected_generation: 3,
      soak_duration_ms: 3_600_000,
      failing_max_share: 0.05,
      recall_on_failing: true,
    });
    expect(recallRuleLine(rule)).toBe("soak 1h, recall when failing > 0.05");
    expect(recallRuleLine({ ...rule, recall_on_failing: false })).toBe(
      "soak 1h, reset only when failing > 0.05",
    );
  });

  it("reads a lost answer as unknown, 409 as stale, and hides refusal text", () => {
    expect(recallRuleOutcome(new TypeError("network")).tone).toBe("unknown");
    expect(recallRuleOutcome(new ApiError(503, "x")).tone).toBe("unknown");
    expect(recallRuleOutcome(new ApiError(409, "secret detail"))).toEqual({
      tone: "bad",
      text: "The policy changed since you read it. Nothing was set; reload and check it.",
      stale: true,
    });
    expect(recallRuleOutcome(new ApiError(403, "secret detail")).text).toBe("Not permitted.");
    expect(recallRuleOutcome(new ApiError(405, "x")).text).toBe(
      "This server cannot edit the recall rule.",
    );
    expect(recallRuleOutcome(new ApiError(400, "secret detail")).text).toBe("Recall rule refused.");
    expect(recallRuleOutcome(undefined)).toEqual({
      tone: "ok",
      text: "Recall rule set and audited.",
    });
  });
});
