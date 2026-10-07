import { describe, expect, it } from "vitest";
import {
  applyBody,
  expectedGeneration,
  parseEvidence,
  planBody,
  signCommand,
  subscribeBody,
} from "./requests";

const envelope = (environment: string) =>
  JSON.stringify({
    schema: "tenkai.plan-approval.v1",
    key_id: "ops-1",
    signature: "c2ln",
    statement: {
      environment,
      expires_at: 2,
      issued_at: 1,
      plan_digest: "sha256:abc",
      policy_digest: "sha256:def",
      policy_evidence_id: "ev-1",
      policy_provider: "tenkai",
      purpose: "apply",
      skip_gates: false,
    },
  });
const roots = JSON.stringify({
  version: 1,
  signers: [{ identity: "ops", key_id: "ops-1", public_key: "k" }],
});

describe("lifecycle requests", () => {
  it("uses the held lease generation, or 0 when free", () => {
    expect(expectedGeneration({ held: true, generation: 41, status: "held" })).toBe(41);
    expect(expectedGeneration({ held: false, generation: 40, status: "free" })).toBe(0);
  });

  it("builds versioned bodies without development bypasses", () => {
    expect(planBody("prod-eu", 0)).toEqual({
      version: 1,
      operation: "plan",
      environment: "prod-eu",
      expected_generation: 0,
    });
    expect(subscribeBody("prod-eu", 41, "api", "stable")).toEqual({
      version: 1,
      operation: "subscribe",
      environment: "prod-eu",
      expected_generation: 41,
      spec: "api=stable",
    });
    const evidence = parseEvidence("prod-eu", envelope("prod-eu"), roots);
    if (typeof evidence === "string") {
      throw new Error(evidence);
    }
    const body = applyBody("prod-eu", 3, evidence);
    expect(body).toMatchObject({ operation: "apply", expected_generation: 3 });
    expect(body).not.toHaveProperty("skip_gates");
    expect(body).not.toHaveProperty("emergency_reason");
  });

  it("refuses malformed or misdirected approval evidence before sending", () => {
    expect(parseEvidence("prod-eu", "{", roots)).toMatch(/^The approval must be the JSON file/);
    expect(parseEvidence("prod-eu", envelope("prod-eu"), "= nope")).toMatch(/^Trust roots must be/);
    expect(parseEvidence("prod-eu", envelope("prod-us"), roots)).toBe(
      "This approval is for prod-us, not prod-eu.",
    );
    expect(parseEvidence("prod-eu", JSON.stringify({ schema: "x" }), roots)).toMatch(
      /^Approval envelope:/,
    );
    expect(parseEvidence("prod-eu", envelope("prod-eu"), JSON.stringify({ version: 1 }))).toMatch(
      /^Trust roots:/,
    );
  });

  it("accepts the TOML trust roots tenkaictl writes", () => {
    const toml =
      'version = 1\n\n[[signers]]\nkey_id = "ops-1"\nidentity = "ops"\npublic_key = "k"\n';
    const evidence = parseEvidence("prod-eu", envelope("prod-eu"), toml);
    expect(evidence).toMatchObject({ trust_roots: { version: 1, signers: [{ key_id: "ops-1" }] } });
  });

  it("shows the signing command with a placeholder until the digest is known", () => {
    expect(signCommand("prod-eu", undefined)).toContain(
      "--plan-digest <plan digest> --env prod-eu",
    );
    expect(signCommand("prod-eu", "sha256:abc")).toContain("--plan-digest sha256:abc");
  });
});
