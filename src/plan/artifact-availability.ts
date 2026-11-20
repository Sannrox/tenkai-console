import { type } from "arktype";

// Plan-time artifact checks (#1062): one result per digest and registry on
// inspect's `latest_plan`. The v0.9.0 pin omits the field; newer servers send
// it. Advice, not proof: apply keeps its own check. Missing already refused
// the plan; unverifiable is shown before signing and does not refuse it.
//
// Reuse decision
// Job: before a change is signed, show whether each content-addressed input
// exists in the store the target reads from; a definite absence already
// refused the plan.
// Verdict: Reuse
// Concept: extra inspect fields as in `config-schema.ts`; arktype parse and
// Card rows as in `approval-brief.ts`; plan POST refusal is `failure()`.
// Edge: no new HTTP route; pin stays (additive JSON). Registry credentials
// never enter the console.
// Searched: approval_brief, target_changes, status_detail, overlayRefusal,
// per-step join. Rejected: pin bump (unrelated contract churn); per-step
// mapping (the public record is digest+registry, not per step); a fourth
// "unreachable" wire state (isolated is unverifiable).

const Check = type({
  digest: "string",
  registry: "string",
  state: "'available' | 'missing' | 'unverifiable'",
  "+": "delete",
});

/** Rows shown before the rest are counted. */
export const ARTIFACT_LIMITS = { rows: 20 } as const;

export const ARTIFACT_COPY = {
  none: "No artifact checks on this plan",
  available: "available",
  missing: "missing",
  unverifiable: "unverifiable",
  applyChecks: "apply checks it",
  allAvailable: "all available",
  more: (count: number) => `${count} more`,
} as const;

export type ArtifactState = "available" | "missing" | "unverifiable";

export type ArtifactRow = {
  digest: string;
  registry: string;
  state: ArtifactState;
};

const rank: Record<ArtifactState, number> = {
  unverifiable: 0,
  missing: 1,
  available: 2,
};

/** Checked artifacts, unverifiable first. Malformed rows are dropped. */
export const artifactView = (plan: unknown): ArtifactRow[] => {
  if (typeof plan !== "object" || plan === null || !("artifact_availability" in plan)) {
    return [];
  }
  const raw = plan.artifact_availability;
  if (!Array.isArray(raw)) {
    return [];
  }
  const rows = raw.flatMap((item) => {
    const value = Check(item);
    return value instanceof type.errors ? [] : [value];
  });
  return rows.toSorted(
    (left, right) =>
      rank[left.state] - rank[right.state] ||
      left.digest.localeCompare(right.digest) ||
      left.registry.localeCompare(right.registry),
  );
};

export const allAvailable = (rows: readonly ArtifactRow[]): boolean =>
  rows.length > 0 && rows.every((row) => row.state === "available");

export const capRows = (
  rows: readonly ArtifactRow[],
): { shown: ArtifactRow[]; hidden: number } => ({
  shown: rows.slice(0, ARTIFACT_LIMITS.rows),
  hidden: Math.max(0, rows.length - ARTIFACT_LIMITS.rows),
});
