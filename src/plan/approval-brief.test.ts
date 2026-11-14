import { describe, expect, it } from "vitest";
import type { ApprovalBrief, EnvironmentPlanSummary } from "../api/tenkai.gen";
import { BRIEF_COPY, BRIEF_LIMITS, briefView, riskyChange } from "./approval-brief";

const BRIEF: ApprovalBrief = {
  proposer: "alice",
  blast_radius: { environment: "prod", instances: ["api"], rollback_available: true },
  changes: { counts: { Deployment: 1, Service: 2 } },
  policy: { without_human: "auto", budget: "not_configured" },
};

const plan = (brief: unknown): EnvironmentPlanSummary =>
  ({
    id: "tenkai:plan:1",
    state: "computed",
    created_at: 1,
    step_count: 1,
    approval_brief: brief,
  }) as EnvironmentPlanSummary;

describe("riskyChange", () => {
  it("names documented codes and keeps the object", () => {
    expect(riskyChange("deleted_volume:Deployment api")).toEqual({
      label: "deleted volume",
      subject: "Deployment api",
    });
    expect(riskyChange("widened_grant:api")).toEqual({ label: "widened grant", subject: "api" });
  });

  it("shows an unknown code rather than dropping it", () => {
    expect(riskyChange("opened_egress")).toEqual({ label: "opened egress", subject: "" });
  });
});

describe("briefView", () => {
  it("reads as missing when the plan has no brief or a malformed one", () => {
    expect(briefView(plan(undefined))).toBeUndefined();
    expect(briefView(plan({ ...BRIEF, policy: { without_human: 1 } }))).toBeUndefined();
  });

  it("summarizes a human plan with no flags or evidence", () => {
    const view = briefView(plan(BRIEF));
    expect(view).toMatchObject({
      risky: [],
      proposer: "alice",
      agent: undefined,
      chain: [],
      withoutHuman: BRIEF_COPY.auto,
      budget: undefined,
      counts: "Deployment 1, Service 2",
      evidence: [],
      rollback: true,
    });
  });

  it("labels an agent plan with the delegating user and an over budget", () => {
    const view = briefView(
      plan({
        ...BRIEF,
        actor_chain: [
          { id: "gateway", kind: "human" },
          { id: "assistant-7", kind: "agent" },
        ],
        policy: { without_human: "require_human", reason: "criticality high", budget: "over" },
      }),
    );
    expect(view?.agent).toBe("assistant-7");
    expect(view?.proposer).toBe("alice");
    expect(view?.chain).toEqual(["gateway human", "assistant-7 agent"]);
    expect(view?.withoutHuman).toBe("needs a human: criticality high");
    expect(view?.budget).toEqual({ text: BRIEF_COPY.over, over: true });
  });

  it("caps risky rows and instances and counts the rest", () => {
    const view = briefView(
      plan({
        ...BRIEF,
        blast_radius: {
          ...BRIEF.blast_radius,
          instances: Array.from({ length: BRIEF_LIMITS.instances + 2 }, (_, i) => `i${i}`),
        },
        changes: {
          risky: Array.from({ length: BRIEF_LIMITS.risky + 3 }, (_, i) => `changed_ports:S s${i}`),
        },
      }),
    );
    expect(view?.risky).toHaveLength(BRIEF_LIMITS.risky);
    expect(view?.riskyHidden).toBe(3);
    expect(view?.instances).toHaveLength(BRIEF_LIMITS.instances);
    expect(view?.instancesHidden).toBe(2);
  });
});
