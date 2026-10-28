import type { PlanApprovalsView } from "../api/tenkai.gen";

/**
 * Approval progress for one plan (GET `/v1/plans/{id}/approvals`,
 * Sannrox/tenkai#681, #817) as the 2026-10-28 pick B matrix (#38). Tenkai's
 * rule is one quorum per purpose: `n` distinct signers from any of the
 * rule's groups, so group columns have no quorum of their own and are headed
 * with the approvals collected in them. With the server's trust roots, rows
 * are every eligible approver; without them (`eligible` absent), only the
 * signers whose approvals were collected. The server counts the quorum and
 * enforces it at apply.
 */

/** A cell: signed (with when, if reported), still pending, or not this group. */
export type Cell = { signedAt: number | undefined } | "pending" | "n/a";

export type QuorumMatrix = {
  /** The rule's groups; `any group` when the rule names none. */
  groups: string[];
  rows: Array<{
    keyId: string;
    signer: string;
    /** When the collected approval expires; absent until one is collected. */
    expiresAt: number | undefined;
    cells: Cell[];
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
  const collected = new Map((view.collected ?? []).map((approval) => [approval.key_id, approval]));
  // Who may sign for each column, by key; `undefined` without trust roots.
  const eligibleIn = view.eligible
    ? groups.map(
        (group) =>
          new Set(
            (view.eligible?.find((entry) => (entry.group ?? ANY) === group)?.approvers ?? []).map(
              (approver) => approver.key_id,
            ),
          ),
      )
    : undefined;
  const people = new Map<string, string>();
  for (const entry of view.eligible ?? []) {
    for (const approver of entry.approvers) {
      people.set(approver.key_id, approver.identity);
    }
  }
  // A collected signer no longer in the roots still shows what it signed.
  for (const approval of collected.values()) {
    if (!people.has(approval.key_id)) {
      people.set(approval.key_id, approval.signer_identity);
    }
  }
  const rows = [...people]
    .toSorted(([, a], [, b]) => a.localeCompare(b))
    .map(([keyId, signer]) => {
      const approval = collected.get(keyId);
      return {
        keyId,
        signer,
        expiresAt: approval?.expires_at,
        cells: groups.map((group, column): Cell => {
          const inGroup = eligibleIn
            ? eligibleIn[column]?.has(keyId) === true
            : group === ANY || (approval?.groups ?? []).includes(group);
          if (approval && (inGroup || group === ANY || (approval.groups ?? []).includes(group))) {
            return { signedAt: approval.signed_at };
          }
          return inGroup ? "pending" : "n/a";
        }),
      };
    });
  return {
    groups,
    rows,
    perGroup: groups.map(
      (_, column) => rows.filter((row) => typeof row.cells[column] === "object").length,
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
