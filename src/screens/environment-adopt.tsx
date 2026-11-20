import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { EnvironmentInspectReport, ManagementLifecycleResult } from "../api/tenkai.gen";
import { useAuthSession } from "../auth/identity";
import {
  COPY,
  adoptGate,
  adoptOutcome,
  adoptRelease,
  differenceFields,
  offerAdopt,
  pendingAdopt,
  recordedAdopt,
  showAdopt,
} from "../delivery/adopt";
import type { LiveWorkload } from "../delivery/identity";
import { useManagementCall } from "../management/use-management";
import { adoptBody, expectedGeneration } from "../plan/requests";
import { ConfirmButton, Notice } from "../ui/kit";
import { td, th } from "../ui/posture";

const field =
  "min-w-0 flex-1 rounded-md border border-field bg-white/4 px-2.5 py-1.5 text-xs text-fg placeholder:text-muted";

/**
 * Live workloads no recorded instance owns, and the adopt action when a
 * chosen catalog pin matches. Adoption is recording only.
 */
export const EnvironmentAdopt = ({
  report,
  token,
  unmanaged,
}: {
  report: EnvironmentInspectReport;
  token: string;
  unmanaged: readonly LiveWorkload[];
}) => {
  const me = useAuthSession(token);
  const grants = me.data?.capabilities;
  const call = useManagementCall(
    token,
    `environment:${report.name}`,
    "management",
    (result: ManagementLifecycleResult) => result.message,
  );
  const [releaseText, setReleaseText] = useState("");
  const release = adoptRelease(releaseText);
  const pending = pendingAdopt(report.latest_plan) || call.isSuccess;
  const recorded = recordedAdopt(report.latest_plan) && unmanaged.length === 0;
  const permitted =
    call.allowed && !me.isPending && (grants === undefined || grants.includes("management"));
  const gate = call.error ? adoptGate(call.error) : undefined;
  const form = showAdopt({
    candidates: unmanaged.length,
    permitted,
    pending,
    gate,
  });
  const adopt = offerAdopt({
    candidates: unmanaged.length,
    permitted,
    release,
    pending,
    gate,
  });
  const outcome = call.isSuccess
    ? adoptOutcome(undefined)
    : call.error
      ? adoptOutcome(call.error)
      : pending
        ? { tone: "ok" as const, text: COPY.pending }
        : recorded
          ? { tone: "ok" as const, text: COPY.adopted }
          : undefined;
  const diffs = call.error ? differenceFields(call.error) : [];
  const generation = expectedGeneration(report.lease);

  return (
    <section aria-label="Unmanaged" className="mt-[18px]">
      <h2 className="mb-2 text-[13px] font-semibold">Unmanaged</h2>
      <div className="overflow-x-auto rounded-card border border-line bg-card">
        {unmanaged.length === 0 ? (
          <p className="m-0 px-3.5 py-3 text-xs text-muted">{COPY.none}</p>
        ) : (
          <table className="w-full border-collapse text-xs" aria-label="Unmanaged">
            <thead>
              <tr>
                <th className={th}>Kind</th>
                <th className={th}>Name</th>
              </tr>
            </thead>
            <tbody>
              {unmanaged.map((workload) => (
                <tr
                  key={`${workload.kind}:${workload.name}`}
                  className="[&:last-child>td]:border-b-0"
                >
                  <td className={`${td} font-mono`}>{workload.kind}</td>
                  <td className={`${td} font-mono`}>{workload.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {form && (
          <div className="flex flex-wrap gap-2 border-t border-line px-3.5 py-3">
            <input
              aria-label="Release"
              placeholder="product@version"
              value={releaseText}
              onChange={(event) => {
                setReleaseText(event.target.value);
                if (call.error) {
                  call.reset();
                }
              }}
              className={field}
            />
            {gate !== "differs" && (
              <ConfirmButton
                label="Adopt"
                confirm={`Record ${release ?? "the chosen release"} on ${report.name} without changing the target`}
                disabled={!adopt || call.isPending}
                onConfirm={() => {
                  if (release === undefined) {
                    return;
                  }
                  call.mutate({
                    path: `v1/environments/${encodeURIComponent(report.name)}/adopt`,
                    body: adoptBody(report.name, generation, release),
                  });
                }}
              />
            )}
          </div>
        )}
        {form && <p className="m-0 px-3.5 pb-3 text-xs text-muted">{COPY.recording}</p>}
        {diffs.length > 0 && (
          <ul className="m-0 list-none px-3.5 py-3 text-xs text-warning">
            {diffs.map((fieldName) => (
              <li key={fieldName} className="font-mono">
                {fieldName}
              </li>
            ))}
          </ul>
        )}
        {outcome && (
          <div className="flex flex-wrap items-center gap-2 px-3.5 py-3">
            <Notice tone={outcome.tone}>{outcome.text}</Notice>
            {(call.isSuccess || pending) && (
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

export default EnvironmentAdopt;
