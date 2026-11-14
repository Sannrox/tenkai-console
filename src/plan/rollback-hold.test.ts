import { describe, expect, it } from "vitest";
import { rollbackHoldChoice, rollbackOnly } from "./rollback-hold";

describe("rollback hold", () => {
  const step = {
    id: "s1",
    order: 1,
    product: "tenkai",
    action: "upgrade",
    from: "0.6.1",
    to: "0.6.0",
    release_id: "tenkai:release:tenkai@0.6.0",
  };
  const rollbackStep = { ...step, action: "rollback" };

  it("offers the opt-out only on a complete rollback-only plan", () => {
    expect(rollbackOnly({ steps: [rollbackStep] })).toBe(true);
    expect(rollbackOnly({ steps: [rollbackStep, step] })).toBe(false);
    expect(rollbackOnly({ steps: [rollbackStep], steps_truncated: true })).toBe(false);
    expect(rollbackOnly({ steps: [] })).toBe(false);
  });

  it("keeps the hold by default and needs a reason to skip it", () => {
    expect(rollbackHoldChoice(true, "")).toEqual({});
    expect(rollbackHoldChoice(false, "  ")).toBeUndefined();
    expect(rollbackHoldChoice(false, " planned outage ")).toEqual({
      noHoldReason: "planned outage",
    });
  });
});
