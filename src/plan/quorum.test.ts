import { describe, expect, it } from "vitest";
import type { PlanApprovalsView } from "../api/tenkai.gen";
import { quorumMatrix, quorumStatus } from "./quorum";

const view = (overrides: Partial<PlanApprovalsView>): PlanApprovalsView => ({
  plan_id: "tenkai:plan:1",
  plan_digest: "sha256:abc",
  purpose: "execute_plan",
  required: 2,
  groups: ["quality", "ops"],
  exclude_requester: false,
  collected: [],
  missing: 2,
  ...overrides,
});

describe("quorum matrix", () => {
  it("lists collected signers by the rule's groups, n/a outside their groups", () => {
    const matrix = quorumMatrix(
      view({
        collected: [
          { key_id: "k2", signer_identity: "bob", groups: ["ops"], expires_at: 20 },
          { key_id: "k1", signer_identity: "alice", groups: ["quality", "ops"], expires_at: 10 },
        ],
        missing: 0,
      }),
    );
    expect(matrix.rows.map((row) => [row.signer, ...row.cells])).toStrictEqual([
      ["alice", "approved", "approved"],
      ["bob", "n/a", "approved"],
    ]);
    expect(matrix.perGroup).toStrictEqual([1, 2]);
    expect(matrix.counted).toBe(2);
    expect(quorumStatus(matrix)).toStrictEqual({
      line: "Quorum met: 2 of 2 approvals counted.",
      applyBlocked: false,
    });
  });

  it("uses one column when the rule names no group", () => {
    const matrix = quorumMatrix(
      view({
        groups: [],
        collected: [{ key_id: "k1", signer_identity: "alice", expires_at: 10 }],
        missing: 1,
      }),
    );
    expect(matrix.groups).toStrictEqual(["any group"]);
    expect(matrix.rows[0]?.cells).toStrictEqual(["approved"]);
  });

  it("blocks Apply only when more approvals are missing than one paste can add", () => {
    expect(quorumStatus(quorumMatrix(view({ missing: 2 })))).toStrictEqual({
      line: "0 of 2 approvals counted; 2 missing.",
      applyBlocked: true,
    });
    expect(quorumStatus(quorumMatrix(view({ missing: 1 })))).toStrictEqual({
      line: "1 of 2 approvals counted; 1 missing. Apply with the last approval pasted below.",
      applyBlocked: false,
    });
  });
});
