import { describe, expect, it } from "vitest";
import type { ExportEntry } from "../api/tenkai.gen";
import { exportRequest, historyRows, size } from "./operations";

const empty = { environment: "", plan_id: "", upgrade: "" };

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
      },
    ]);
    expect([size(512), size(2_048), size(3 * 1_048_576)]).toStrictEqual([
      "512 B",
      "2.0 KB",
      "3.0 MB",
    ]);
  });
});
