import type { PlanApprovalsView } from "../api/tenkai.gen";

/**
 * Approval progress for one plan (GET `/v1/plans/{id}/approvals`,
 * Sannrox/tenkai#681), as the 2026-10-28 pick B matrix (#38) can show it
 * from what Tenkai reports. Tenkai's rule is one quorum per purpose: `n`
 * distinct signers from any of the rule's groups, so groups have no quorum
 * of their own. It reports the approvals collected, not the approvers
 * eligible to sign, and no signing time, so rows are collected signers and a
 * cell says whether that signer's approval belongs to the group. The server
 * counts the quorum and enforces it at apply.
 */
export type QuorumMatrix = {
  /** The rule's groups; `any group` when the rule names none. */
  groups: string[];
  rows: Array<{
    keyId: string;
    signer: string;
    expiresAt: number;
    /** Per column: `approved`, or `n/a` when the signer is not in that group. */
    cells: Array<"approved" | "n/a">;
  }>;
  /** Collected approvals per column. */
  perGroup: number[];
  required: number;
  /** Approvals the server counted towards the quorum. */
  counted: number;
  missing: number;
};

const ANY = "any group";

export const quorumMatrix = (view: PlanApprovalsView): QuorumMatrix => {
  const ruleGroups = view.groups ?? [];
  const groups = ruleGroups.length > 0 ? ruleGroups : [ANY];
  const rows = (view.collected ?? [])
    .toSorted((a, b) => a.signer_identity.localeCompare(b.signer_identity))
    .map((approval) => ({
      keyId: approval.key_id,
      signer: approval.signer_identity,
      expiresAt: approval.expires_at,
      cells: groups.map((group): "approved" | "n/a" =>
        group === ANY || (approval.groups ?? []).includes(group) ? "approved" : "n/a",
      ),
    }));
  return {
    groups,
    rows,
    perGroup: groups.map(
      (_, column) => rows.filter((row) => row.cells[column] === "approved").length,
    ),
    required: view.required,
    counted: Math.max(0, view.required - view.missing),
    missing: view.missing,
  };
};

/** The line under the matrix, and whether Apply may be pressed. */
export const quorumStatus = (matrix: QuorumMatrix): { line: string; applyBlocked: boolean } =>
  matrix.missing === 0
    ? {
        line: `Quorum met: ${matrix.counted} of ${matrix.required} approvals counted.`,
        applyBlocked: false,
      }
    : {
        line: `${matrix.counted} of ${matrix.required} approvals counted; ${matrix.missing} missing.${
          matrix.missing === 1 ? " Apply with the last approval pasted below." : ""
        }`,
        // One pasted envelope adds at most one approval.
        applyBlocked: matrix.missing > 1,
      };
