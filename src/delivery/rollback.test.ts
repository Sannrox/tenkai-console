import { describe, expect, it } from "vitest";
import type { EnvironmentInspectReport, EnvironmentPlanSummary } from "../api/tenkai.gen";
import { DOWNGRADE_NOTICE, previousRelease, rollbackConfirmed, rollbackSummary } from "./rollback";

const env = (latest_plan: EnvironmentPlanSummary | null = null): EnvironmentInspectReport => ({
  name: "prod",
  id: "tenkai:env:prod",
  description: "",
  execution_note: "",
  facts: {},
  lease: { held: false, status: "free" },
  subscriptions: [
    { product: "tenkai", channel: "stable", head: "0.6.1", deployed: "0.6.1", state: "current" },
  ],
  latest_plan,
});

const upgrade = (from: string | null): EnvironmentPlanSummary => ({
  id: "tenkai:plan:pln-22",
  state: "succeeded",
  created_at: 0,
  step_count: 1,
  steps: [
    {
      id: "s1",
      order: 1,
      product: "tenkai",
      action: "upgrade",
      from,
      to: "0.6.1",
      release_id: "tenkai:release:tenkai@0.6.1",
    },
  ],
});

describe("previousRelease", () => {
  it("names the upgrade from-pin when that upgrade is what is deployed", () => {
    expect(previousRelease(env(upgrade("0.6.0")), "tenkai")).toBe("0.6.0");
  });

  it("is absent when the latest plan is not a succeeded upgrade of the deployed pin", () => {
    expect(previousRelease(env(upgrade(null)), "tenkai")).toBeUndefined();
    expect(previousRelease(env(upgrade("0.6.0")), "web")).toBeUndefined();
    expect(
      previousRelease(env({ ...upgrade("0.6.0"), state: "computed" }), "tenkai"),
    ).toBeUndefined();
    expect(
      previousRelease(
        env({
          ...upgrade("0.6.1"),
          steps: [{ ...upgrade("0.6.1").steps![0]!, from: "0.6.1", to: "0.6.2" }],
        }),
        "tenkai",
      ),
    ).toBeUndefined();
    expect(
      previousRelease(
        env({
          ...upgrade("0.6.0"),
          steps: [
            { ...upgrade("0.6.0").steps![0]!, action: "rollback", from: "0.6.1", to: "0.6.0" },
          ],
        }),
        "tenkai",
      ),
    ).toBeUndefined();
    expect(previousRelease(env(), "tenkai")).toBeUndefined();
  });
});

describe("rollback dialog (#28)", () => {
  it("states product, from and to, and the approval before anything is sent", () => {
    expect(rollbackSummary(env(upgrade("0.6.0")), "tenkai", "0.6.0")).toEqual([
      { label: "product", value: "tenkai" },
      { label: "from → to", value: "0.6.1 → 0.6.0" },
      { label: "approval", value: "required: a human-signed downgrade approval" },
    ]);
    expect(rollbackSummary(env(), "tenkai", undefined)[1]).toEqual({
      label: "from → to",
      value: "0.6.1 → previous release",
    });
  });

  it("confirms only with a reason and the environment name typed exactly", () => {
    expect(rollbackConfirmed("prod", "prod", "checkout errors")).toBe(true);
    expect(rollbackConfirmed("prod", "prod", "  ")).toBe(false);
    expect(rollbackConfirmed("prod", "Prod", "checkout errors")).toBe(false);
    expect(rollbackConfirmed("prod", "prod ", "checkout errors")).toBe(false);
  });

  it("explains the downgrade approval before submit", () => {
    expect(DOWNGRADE_NOTICE).toMatch(/human-signed approval/);
    expect(DOWNGRADE_NOTICE).toMatch(/Automatic envelopes are not reused/);
  });
});
