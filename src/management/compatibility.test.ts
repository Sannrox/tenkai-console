import { describe, expect, it } from "vitest";
import { groupFailures, parseObservation, standing } from "./compatibility";

const observation = {
  version: 1,
  environment: "prod-eu",
  release_digest: "8f3a",
  observed_at_ms: 1,
  components: { web: { pin: { kind: "digest", value: "sha256:aa" }, requires: {}, provides: {} } },
  contracts: {},
  capabilities: ["containers"],
  schema_version: 3,
  migration: "stable",
};

describe("compatibility", () => {
  it("groups failures by kind, subjects sorted", () => {
    expect(
      groupFailures([
        { reason: "missing_capability", capability: "gpu" },
        { reason: "incompatible_contract", contract: "payments/v3" },
        { reason: "component_changed", component: "web" },
        { reason: "missing_component", component: "db" },
        { reason: "stale_evidence" },
      ]),
    ).toEqual([
      { kind: "evidence", failures: [{ reason: "stale_evidence" }] },
      {
        kind: "component",
        failures: [
          { reason: "missing_component", subject: "db" },
          { reason: "component_changed", subject: "web" },
        ],
      },
      { kind: "contract", failures: [{ reason: "incompatible_contract", subject: "payments/v3" }] },
      { kind: "capability", failures: [{ reason: "missing_capability", subject: "gpu" }] },
    ]);
  });

  it("reads a release without a profile as nothing to check", () => {
    expect(standing(null)).toBe("no-profile");
    expect(standing({ version: 1, release_digest: "8f3a", failures: [] })).toBe("compatible");
    expect(
      standing({ version: 1, release_digest: "8f3a", failures: [{ reason: "missing_evidence" }] }),
    ).toBe("incompatible");
  });

  it("sends an observation only for its own environment", () => {
    const text = JSON.stringify(observation);
    expect(parseObservation(text, "prod-eu")).toEqual(observation);
    expect(parseObservation(text, "staging")).toBe("The evidence is for prod-eu, not staging.");
    expect(parseObservation("not json", "prod-eu")).toMatch(/observation JSON/);
    expect(parseObservation(JSON.stringify({ version: 1 }), "prod-eu")).toMatch(/^Evidence: /);
  });
});
