import { useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { request } from "../api/http";
import type {
  AdvisoryFeedStatus,
  EnvironmentInspectReport,
  ManagementLifecycleResult,
} from "../api/tenkai.gen";
import { useAuthSession } from "../auth/identity";
import { fetchRecall } from "../delivery/recall";
import {
  COPY,
  advisoriesFor,
  exposureLine,
  isHealthRecall,
  offerAdmit,
  pendingFixes,
  upgradeGate,
  upgradeOutcome,
} from "../delivery/recalled-upgrade";
import { useManagementCall } from "../management/use-management";
import { expectedGeneration, planBody } from "../plan/requests";
import { ConfirmButton, Notice } from "../ui/kit";
import { td, th } from "../ui/posture";

const field =
  "min-w-0 flex-1 rounded-md border border-field bg-white/4 px-2.5 py-1.5 text-xs text-fg placeholder:text-muted";

/**
 * Behind instances whose channel head is recalled: current and recalled
 * exposure from the advisory feed, and the admit action when the recall is
 * not a health recall and the caller may manage.
 */
export const RecalledUpgrade = ({
  report,
  token,
}: {
  report: EnvironmentInspectReport;
  token: string;
}) => {
  const fixes = pendingFixes(report.subscriptions);
  const targets = [...new Set(fixes.map((fix) => fix.target))];
  const feed = useQuery({
    queryKey: ["advisory-feed", token],
    queryFn: () => request<AdvisoryFeedStatus>("v1/advisory-feed", { token }),
    enabled: targets.length > 0,
    retry: false,
  });
  const recalls = useQueries({
    queries: targets.map((target) => ({
      queryKey: ["recall", token, target],
      queryFn: () => fetchRecall(target, token),
      enabled: targets.length > 0,
      retry: false,
    })),
  });
  const me = useAuthSession(token);
  const grants = me.data?.capabilities;
  const call = useManagementCall(
    token,
    `environment:${report.name}`,
    "management",
    (result: ManagementLifecycleResult) => result.message,
  );
  const [reason, setReason] = useState("");
  if (targets.length === 0) {
    return null;
  }
  if (recalls.some((query) => query.data === undefined && !query.isError)) {
    return null;
  }
  const byTarget = new Map(targets.map((target, index) => [target, recalls[index]?.data]));
  const rows = fixes.filter((fix) => {
    const load = byTarget.get(fix.target);
    return load?.kind === "ok" || load?.kind === "forbidden";
  });
  if (rows.length === 0) {
    return null;
  }
  const matches = feed.data?.matches ?? [];
  const health =
    rows.length > 0 &&
    rows.every((row) => {
      const load = byTarget.get(row.target);
      return load?.kind === "ok" && isHealthRecall(load.value);
    });
  const recalled = rows.some((row) => {
    const load = byTarget.get(row.target);
    return load?.kind === "ok" && !isHealthRecall(load.value);
  });
  const recallForbidden = rows.some((row) => byTarget.get(row.target)?.kind === "forbidden");
  const permitted =
    call.allowed &&
    !me.isPending &&
    !recallForbidden &&
    (grants === undefined || grants.includes("management"));
  const gate = call.error ? upgradeGate(call.error) : undefined;
  const admit = offerAdmit({ recalled, health, permitted, gate });
  const outcome = call.isSuccess
    ? upgradeOutcome(undefined)
    : call.error
      ? upgradeOutcome(call.error)
      : undefined;
  const why = reason.trim();
  const generation = expectedGeneration(report.lease);

  return (
    <section aria-label="Pending fix" className="mt-[18px]">
      <h2 className="mb-2 text-[13px] font-semibold">Pending fix</h2>
      <div className="overflow-x-auto rounded-card border border-line bg-card">
        <table className="w-full border-collapse text-xs" aria-label="Pending fix">
          <thead>
            <tr>
              <th className={th}>Instance</th>
              <th className={th}>Current</th>
              <th className={th}>Recalled</th>
              <th className={th}>Current exposure</th>
              <th className={th}>Recalled exposure</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.instance} className="[&:last-child>td]:border-b-0">
                <td className={`${td} font-mono`}>{row.instance}</td>
                <td className={`${td} font-mono`}>{row.current}</td>
                <td className={`${td} font-mono`}>{row.target}</td>
                <td className={`${td} font-mono`}>
                  {exposureLine(advisoriesFor(matches, row.current))}
                </td>
                <td className={`${td} font-mono`}>
                  {exposureLine(advisoriesFor(matches, row.target))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {admit && (
          <div className="flex flex-wrap gap-2 border-t border-line px-3.5 py-3">
            <input
              aria-label="Upgrade reason"
              placeholder="Reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className={field}
            />
            <ConfirmButton
              label="Admit lower-exposure upgrade"
              confirm={`Admit ${report.name} onto the recalled release`}
              disabled={why === "" || call.isPending}
              onConfirm={() =>
                call.mutate({
                  path: `v1/environments/${encodeURIComponent(report.name)}/plans`,
                  body: planBody(report.name, generation, why),
                })
              }
            />
          </div>
        )}
        {health && !admit && <p className="m-0 px-3.5 py-3 text-xs text-muted">{COPY.health}</p>}
        {outcome && (
          <div className="flex flex-wrap items-center gap-2 px-3.5 py-3">
            <Notice tone={outcome.tone}>{outcome.text}</Notice>
            {call.isSuccess && (
              <Link
                to="/environments/$environment/plan"
                params={{ environment: report.name }}
                className="text-xs font-medium text-muted"
              >
                Open plan
              </Link>
            )}
          </div>
        )}
      </div>
    </section>
  );
};

export default RecalledUpgrade;
