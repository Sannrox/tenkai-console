import { describe, expect, it } from "vitest";
import type { ExportEntry } from "../api/tenkai.gen";
import { auditRange, exportRequest, historyRows, size } from "./operations";

const empty = {
  environment: "",
  plan_id: "",
  upgrade: "",
  from_sequence: "",
  to_sequence: "",
};

describe("export requests", () => {
  it("needs a reason, and the fields a kind takes, and sends only those", () => {
    expect(exportRequest("support-bundle", " ", empty)).toBe("a reason is required");
    expect(
      exportRequest("support-bundle", " ticket 42 ", { ...empty, environment: "prod" }),
    ).toStrictEqual({ kind: "support-bundle", reason: "ticket 42" });
    expect(exportRequest("recovery-bundle", "incident", { ...empty, environment: "prod" })).toBe(
      "plan_id required",
    );
    expect(
      exportRequest("offline-receipt", "audit", {
        ...empty,
        environment: "site",
        plan_id: "p",
        upgrade: "u1",
      }),
    ).toStrictEqual({
      kind: "offline-receipt",
      reason: "audit",
      environment: "site",
      upgrade: "u1",
    });
  });
});

describe("audit ranges", () => {
  it("sends both sequences or neither, as whole numbers in order", () => {
    expect(exportRequest("audit-export", "review", empty)).toStrictEqual({
      kind: "audit-export",
      reason: "review",
    });
    expect(
      exportRequest("audit-export", "review", { ...empty, from_sequence: " 3 ", to_sequence: "7" }),
    ).toStrictEqual({ kind: "audit-export", reason: "review", from_sequence: 3, to_sequence: 7 });
    expect(auditRange("4", "4")).toStrictEqual({ from_sequence: 4, to_sequence: 4 });
    expect(auditRange("3", "")).toBe("from and to go together");
    expect(auditRange("", "3")).toBe("from and to go together");
    for (const [from, to] of [
      ["1.5", "3"],
      ["-1", "3"],
      ["1e2", "300"],
      ["a", "3"],
      ["9".repeat(400), "9".repeat(400)],
      ["9007199254740993", "9007199254740993"],
    ] as const) {
      expect(auditRange(from, to)).toBe("from and to are whole sequence numbers");
    }
    expect(auditRange("0", "3")).toBe("from is 1 or more and no higher than to");
    expect(auditRange("7", "3")).toBe("from is 1 or more and no higher than to");
    expect(auditRange("1", "1001")).toBe("at most 1000 entries");
    expect(auditRange("1", "1000")).toStrictEqual({ from_sequence: 1, to_sequence: 1_000 });
    // Other kinds never send a range.
    expect(
      exportRequest("support-bundle", "x", { ...empty, from_sequence: "1", to_sequence: "2" }),
    ).toStrictEqual({ kind: "support-bundle", reason: "x" });
  });
});

describe("export history", () => {
  it("names who created each export, why, and how often it was downloaded", () => {
    const entry: ExportEntry = {
      schema: "tenkai.export.v1",
      id: "e1",
      kind: "recovery-bundle",
      environment: "prod",
      file_name: "recovery.json",
      sha256: "abc",
      size_bytes: 2_048,
      created_at_ms: 1_000,
      expires_at_ms: 9_000,
      expired: false,
      events: [
        { action: "created", at_ms: 1_000, principal: "alice", reason: "incident 7" },
        { action: "downloaded", at_ms: 2_000, principal: "bob", reason: "review" },
        { action: "downloaded", at_ms: 3_000, principal: "bob", reason: "again" },
      ],
    };
    expect(historyRows([entry])).toStrictEqual([
      {
        id: "e1",
        kind: "recovery-bundle",
        environment: "prod",
        fileName: "recovery.json",
        createdAt: 1_000,
        createdBy: "alice",
        reason: "incident 7",
        sizeBytes: 2_048,
        downloads: 2,
        expiresAt: 9_000,
        expired: false,
        sequences: "",
      },
    ]);
    const audit = (from: number, to: number) =>
      historyRows([{ ...entry, kind: "audit-export", audit_range: { from, to } }])[0]?.sequences;
    expect([audit(4, 4), audit(3, 7)]).toStrictEqual(["4", "3 to 7"]);
    expect([size(512), size(2_048), size(3 * 1_048_576)]).toStrictEqual([
      "512 B",
      "2.0 KB",
      "3.0 MB",
    ]);
  });
});
