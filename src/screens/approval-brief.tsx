import type { EnvironmentPlanSummary } from "../api/tenkai.gen";
import { BRIEF_COPY, briefView } from "../plan/approval-brief";
import { Card } from "../ui/kit";

const dt = "text-muted";
const dd = "m-0 min-w-0 break-words";

/**
 * The approval brief leads the plan page: flagged risky changes first so they
 * sit above the fold, then who proposed the plan, what policy would do
 * without a human, the blast radius, change counts, and attached evidence.
 */
export const ApprovalBrief = ({ plan }: { plan: EnvironmentPlanSummary }) => {
  const brief = briefView(plan);
  return (
    <section aria-label="Approval brief" className="mb-4">
      <h2 className="mt-0 mb-2 text-[13px] font-semibold">Brief</h2>
      {brief === undefined ? (
        <p className="m-0 text-xs text-muted">{BRIEF_COPY.missing}</p>
      ) : (
        <Card>
          <dl className="m-0 grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1 px-3.5 py-3 text-xs">
            <dt className={dt}>risky</dt>
            <dd className={dd} aria-label="Risky changes">
              {brief.risky.length === 0 ? (
                <span className="text-muted">{BRIEF_COPY.noRisk}</span>
              ) : (
                <>
                  {brief.risky.map((change) => (
                    <div key={`${change.label}:${change.subject}`}>
                      <span className="text-danger">{change.label}</span>{" "}
                      <span className="font-mono break-all">{change.subject}</span>
                    </div>
                  ))}
                  {brief.riskyHidden > 0 && (
                    <div className="text-muted">{BRIEF_COPY.more(brief.riskyHidden)}</div>
                  )}
                </>
              )}
            </dd>
            <dt className={dt}>proposed</dt>
            <dd className={dd}>
              {brief.agent === undefined ? (
                <span className="font-mono">{brief.proposer}</span>
              ) : (
                <>
                  <span className="text-warning">{BRIEF_COPY.agent}</span>{" "}
                  <span className="font-mono">{brief.agent}</span> for{" "}
                  <span className="font-mono">{brief.proposer}</span>
                </>
              )}
            </dd>
            {brief.chain.length > 0 && (
              <>
                <dt className={dt}>actors</dt>
                <dd className={`${dd} font-mono`}>{brief.chain.join(", ")}</dd>
              </>
            )}
            <dt className={dt}>no human</dt>
            <dd className={`${dd} ${brief.withoutHuman === BRIEF_COPY.auto ? "text-ok" : ""}`}>
              {brief.withoutHuman}
            </dd>
            {brief.budget && (
              <>
                <dt className={dt}>budget</dt>
                <dd className={`${dd} ${brief.budget.over ? "text-danger" : ""}`}>
                  {brief.budget.text}
                </dd>
              </>
            )}
            <dt className={dt}>blast radius</dt>
            <dd className={dd}>
              <span className="font-mono">{brief.environment}</span>
              {brief.instances.length > 0 && (
                <>
                  {" · "}
                  <span className="font-mono">{brief.instances.join(", ")}</span>
                  {brief.instancesHidden > 0 && (
                    <span className="text-muted"> {BRIEF_COPY.more(brief.instancesHidden)}</span>
                  )}
                </>
              )}
              {brief.criticality && <> · criticality {brief.criticality}</>}
              {" · "}
              <span className={brief.rollback ? "" : "text-warning"}>
                {brief.rollback ? BRIEF_COPY.rollback : BRIEF_COPY.noRollback}
              </span>
            </dd>
            {brief.counts && (
              <>
                <dt className={dt}>changes</dt>
                <dd className={`${dd} font-mono`}>{brief.counts}</dd>
              </>
            )}
            <dt className={dt}>evidence</dt>
            <dd className={`${dd} ${brief.evidence.length === 0 ? "text-muted" : ""}`}>
              {brief.evidence.length === 0 ? BRIEF_COPY.noEvidence : brief.evidence.join(", ")}
            </dd>
          </dl>
        </Card>
      )}
    </section>
  );
};
