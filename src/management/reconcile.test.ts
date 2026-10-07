import { describe, expect, it } from "vitest";
import { tickLines, tickSummary } from "./reconcile";

const report = {
  environments: [
    { environment: "staging", status: { state: "failed" as const, error: "not deployable" } },
    { environment: "local", status: { state: "current" as const } },
    {
      environment: "prod",
      status: { state: "awaiting_approval" as const, plan_id: "plan:1", steps: 2 },
    },
    { environment: "edge", status: { state: "busy" as const } },
  ],
};

describe("reconcile tick", () => {
  it("reports each environment in the server's terms, sorted by name", () => {
    expect(tickLines(report)).toStrictEqual([
      { environment: "edge", tone: "warn", text: "busy, skipped this tick" },
      { environment: "local", tone: "ok", text: "current" },
      { environment: "prod", tone: "warn", text: "awaiting approval, plan plan:1" },
      { environment: "staging", tone: "bad", text: "failed: not deployable" },
    ]);
  });

  it("summarizes the tick without calling a failed tick success", () => {
    expect(tickSummary(report)).toBe("Tick ran: 4 environments, 1 failed");
    expect(tickSummary({ environments: [] })).toBe("Tick ran: 0 environments");
  });
});
