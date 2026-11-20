import { ARTIFACT_COPY, allAvailable, artifactView, capRows } from "../plan/artifact-availability";
import { Card } from "../ui/kit";

const TONE = {
  available: "text-ok",
  missing: "text-danger",
  unverifiable: "text-warning",
} as const;

/**
 * Plan-time artifact checks above the approval controls so an approver sees
 * unverifiable digests before signing. Missing already refused the plan.
 */
export const ArtifactAvailability = ({ plan }: { plan: unknown }) => {
  const rows = artifactView(plan);
  const { shown, hidden } = capRows(rows);
  return (
    <section aria-label="Artifacts" className="mb-4">
      <h2 className="mt-0 mb-2 text-[13px] font-semibold">Artifacts</h2>
      {rows.length === 0 ? (
        <p className="m-0 text-xs text-muted">{ARTIFACT_COPY.none}</p>
      ) : (
        <Card>
          {allAvailable(rows) && (
            <p className="m-0 px-3.5 pt-3 text-xs text-ok">{ARTIFACT_COPY.allAvailable}</p>
          )}
          <div className="px-3.5 py-3 font-mono text-xs leading-[1.7]">
            {shown.map((row) => (
              <div key={`${row.digest}:${row.registry}`} className="flex min-w-0 flex-wrap gap-x-2">
                <span className="min-w-0 break-all">{row.digest}</span>
                <span className="text-muted">{row.registry}</span>
                <span className={`${TONE[row.state]} whitespace-nowrap`}>
                  {ARTIFACT_COPY[row.state]}
                </span>
                {row.state === "unverifiable" && (
                  <span className="text-muted whitespace-nowrap">{ARTIFACT_COPY.applyChecks}</span>
                )}
              </div>
            ))}
            {hidden > 0 && <div className="text-muted">{ARTIFACT_COPY.more(hidden)}</div>}
          </div>
        </Card>
      )}
    </section>
  );
};
