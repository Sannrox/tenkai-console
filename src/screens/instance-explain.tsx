import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { STALE_PLAN_CHECK, fetchExplain, nextChangeLine } from "../delivery/explain";
import { Button, Card } from "../ui/kit";

const th = "border-b border-line px-3.5 py-2 text-left font-medium whitespace-nowrap text-muted";
const td = "border-b border-line px-3.5 py-2 align-top";

const COPY = {
  unavailable: "This server does not explain blockers.",
  forbidden: "No access",
  loading: "Loading",
  clear: "Nothing blocks",
  stale: "stale, re-plan",
} as const;

/**
 * What blocks one instance's next change, in the order Tenkai reports it.
 * GET `/v1/environments/{environment}/instances/{instance}/explain`.
 */
export const InstanceExplain = ({
  environment,
  instance,
  token,
  onClose,
}: {
  environment: string;
  instance: string;
  token: string;
  onClose: () => void;
}) => {
  const query = useQuery({
    queryKey: ["explain", environment, instance, token],
    queryFn: () => fetchExplain(environment, instance, token),
    retry: false,
  });
  const load = query.data;

  let body;
  if (load === undefined) {
    body = <p className="m-0 px-3.5 py-3 text-xs text-muted">{COPY.loading}</p>;
  } else if (load.kind === "unavailable") {
    body = <p className="m-0 px-3.5 py-3 text-xs text-muted">{COPY.unavailable}</p>;
  } else if (load.kind === "forbidden") {
    body = <p className="m-0 px-3.5 py-3 text-xs text-muted">{COPY.forbidden}</p>;
  } else if (load.kind === "error") {
    body = (
      <p role="alert" className="m-0 px-3.5 py-3 text-xs text-danger">
        {load.message}
      </p>
    );
  } else {
    const { blockers, next_change: next } = load.value;
    body = (
      <>
        {blockers.length === 0 ? (
          <p className="m-0 px-3.5 py-3 text-xs text-ok">{COPY.clear}</p>
        ) : (
          <table className="w-full border-collapse text-xs" aria-label="Blockers">
            <thead>
              <tr>
                <th className={th}>Check</th>
                <th className={th}>Evidence</th>
                <th className={th}>Unblock</th>
              </tr>
            </thead>
            <tbody>
              {blockers.map((blocker, index) => (
                // oxlint-disable-next-line no-array-index-key -- server order; a check may repeat
                <tr key={index} className="[&:last-child>td]:border-b-0">
                  <td className={`${td} font-mono whitespace-nowrap text-warning`}>
                    {blocker.check}
                    {blocker.check === STALE_PLAN_CHECK && (
                      <div className="font-sans">
                        {COPY.stale}{" "}
                        <Link
                          to="/environments/$environment/plan"
                          params={{ environment }}
                          className="font-medium text-fg"
                        >
                          Open plan
                        </Link>
                      </div>
                    )}
                  </td>
                  <td className={`${td} [overflow-wrap:anywhere]`}>{blocker.evidence}</td>
                  <td className={`${td} font-mono [overflow-wrap:anywhere]`}>{blocker.unblock}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {next && (
          <dl className="m-0 grid grid-cols-[120px_1fr] gap-x-3 border-t border-line px-3.5 py-3 text-xs">
            <dt className="text-muted">next change</dt>
            <dd className="m-0 font-mono">{nextChangeLine(next)}</dd>
          </dl>
        )}
      </>
    );
  }

  return (
    <section aria-label={`Next change for ${instance}`}>
      <div className="mt-[18px] mb-2 flex items-center gap-2">
        <h2 className="m-0 text-[13px] font-semibold">
          Next change <span className="font-mono">{instance}</span>
        </h2>
        <Button variant="ghost" className="ml-auto" onClick={onClose}>
          Close
        </Button>
      </div>
      <Card className="min-w-0 overflow-x-auto">{body}</Card>
    </section>
  );
};

export default InstanceExplain;
