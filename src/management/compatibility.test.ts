import { describe, expect, it } from "vitest";
import type { CompatibilityReport } from "../api/tenkai.gen";
import {
  edgeRows,
  failureLabel,
  failureLines,
  groupFailures,
  matchedLine,
  parseObservation,
  standing,
} from "./compatibility";

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
    ).toBe("blocked");
  });

  it("names matched providers and contract edges without raw reason suffixes", () => {
    const report = {
      version: 1,
      release_digest: "8f3a",
      failures: [
        { reason: "missing_contract" as const, contract: "analytics" },
        { reason: "incompatible_contract" as const, contract: "payments" },
      ],
      satisfied_by: { catalog: "catalog@1.4.0", database: "postgres@16.2.0" },
    };
    expect(matchedLine(report)).toBe("catalog@1.4.0 · postgres@16.2.0");
    expect(failureLabel("incompatible_contract")).toBe("incompatible");
    expect(failureLines(report.failures)).toEqual(["analytics missing", "payments incompatible"]);
    expect(edgeRows(report)).toEqual([
      { contract: "catalog", status: "matched", statusTone: "ok", providedBy: "catalog@1.4.0" },
      { contract: "database", status: "matched", statusTone: "ok", providedBy: "postgres@16.2.0" },
      { contract: "analytics", status: "missing", statusTone: "bad", providedBy: "none" },
      { contract: "payments", status: "incompatible", statusTone: "bad", providedBy: "none" },
    ]);
    expect(matchedLine({ version: 1, release_digest: "8f3a", failures: [] })).toBe("none");
    expect(
      matchedLine({
        version: 1,
        release_digest: "8f3a",
        failures: [],
        satisfied_by: "postgres@16.2.0",
      } as unknown as CompatibilityReport),
    ).toBe("none");
  });

  it("sends an observation only for its own environment", () => {
    const text = JSON.stringify(observation);
    expect(parseObservation(text, "prod-eu")).toEqual(observation);
    expect(parseObservation(text, "staging")).toBe("The evidence is for prod-eu, not staging.");
    expect(parseObservation("not json", "prod-eu")).toMatch(/observation JSON/);
    expect(parseObservation(JSON.stringify({ version: 1 }), "prod-eu")).toMatch(/^Evidence: /);
  });
});
