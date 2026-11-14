import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { at } from "../delivery/promotion-policies";
import {
  fetchRecall,
  measuredShares,
  percent,
  recallActor,
  recallRange,
  recordedBeforeMeasures,
  removalByEnvironment,
  removalTotals,
  type RecallView,
} from "../delivery/recall";
import { Card } from "../ui/kit";
import { td, th } from "../ui/posture";

const LOAD_TEXT = {
  "not-recalled": "Not recalled.",
  unavailable: "This server does not report recall detail.",
  forbidden: "No access",
} as const;

/**
 * One recorded recall, read-only: who recalled and why, the measured shares
 * and the threshold they exceeded, the failing instances with their checks,
 * the range it covers, and removal per environment as done of total with the
 * instances that still run the release. A recall recorded before the server
 * kept those measures says so instead of claiming a stalled removal.
 */
export const RecallDetail = ({ token, release }: { token: string; release: string }) => {
  const query = useQuery({
    queryKey: ["recall", token, release],
    queryFn: () => fetchRecall(release, token),
    retry: false,
  });
  const load = query.data;
  return (
    <section aria-label="Recall detail" className="mb-2">
      {load === undefined ? null : load.kind === "ok" ? (
        <Recall view={load.value} />
      ) : (
        <p className="m-0 text-xs text-muted">
          {load.kind === "error" ? load.message : LOAD_TEXT[load.kind]}
        </p>
      )}
    </section>
  );
};

const Item = ({
  label,
  children,
  tone = "",
}: {
  label: string;
  children: ReactNode;
  tone?: string;
}) => (
  <>
    <dt className="text-muted">{label}</dt>
    <dd className={`m-0 min-w-0 break-words ${tone}`}>{children}</dd>
  </>
);

const Recall = ({ view }: { view: RecallView }) => {
  const range = recallRange(view);
  const removal = removalByEnvironment(view);
  const left = removal.filter((row) => row.instances.length > 0).length;
  // Before measures, `done` is never counted, so it is not shown as a stall.
  const before = recordedBeforeMeasures(view);
  const totals = before ? undefined : removalTotals(removal);
  const shares = measuredShares(view);
  const failing = view.failing_instances ?? [];
  const counted = removal.some((row) => row.counts);
  return (
    <Card className="px-3.5 py-3 text-xs">
      <dl aria-label="Recall" className="m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
        <Item label="Release">
          <span className="font-mono">{view.release}</span>
        </Item>
        <Item label="Recalled by">
          <span className="font-mono">{recallActor(view)}</span>
          {view.recalled_at !== undefined && ` at ${at(view.recalled_at)}`}
        </Item>
        {view.reason !== undefined && <Item label="Reason">{view.reason}</Item>}
        {shares !== undefined && <Item label="Measured">{shares}</Item>}
        {view.failing_max_share !== undefined && (
          <Item label="Threshold" tone="text-danger">
            failing {">"} {percent(view.failing_max_share)}, exceeded
          </Item>
        )}
        {before && (
          <Item label="Measured" tone="text-muted">
            not recorded, recalled before this server kept measures
          </Item>
        )}
        {failing.length > 0 && (
          <Item label="Failing">
            <ul aria-label="Failing instances" className="m-0 list-none p-0">
              {failing.map((instance) => (
                <li key={instance} className="font-mono">
                  {instance}
                </li>
              ))}
            </ul>
          </Item>
        )}
        <Item label="Range" tone={range.future ? "text-warning" : ""}>
          {range.text}
        </Item>
        <Item label="Removal" tone={left === 0 ? "text-ok" : "text-warning"}>
          {left === 0
            ? "complete, no instance runs it"
            : `in progress, ${left} ${left === 1 ? "environment" : "environments"} left`}
          {totals !== undefined && ` · ${totals.done} of ${totals.total} instances removed`}
        </Item>
      </dl>
      {removal.length > 0 && (
        <table aria-label="Removal progress" className="mt-2 w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className={th}>Environment</th>
              {counted && <th className={th}>Removed</th>}
              <th className={th}>Still running</th>
            </tr>
          </thead>
          <tbody>
            {removal.map((row) => (
              <tr key={row.environment} className="[&:last-child>td]:border-b-0">
                <td className={td}>{row.environment}</td>
                {counted && (
                  <td className={`${td} font-mono ${before ? "text-muted" : ""}`}>
                    {row.counts === undefined
                      ? ""
                      : before
                        ? "not recorded"
                        : `${row.counts.done} of ${row.counts.total}`}
                  </td>
                )}
                <td className={`${td} font-mono whitespace-normal`}>
                  {row.instances.length === 0 ? "none" : row.instances.join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
};

export default RecallDetail;
