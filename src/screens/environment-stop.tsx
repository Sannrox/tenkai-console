import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { EnvironmentInspectReport, ManagementLifecycleResult } from "../api/tenkai.gen";
import { useManagementCall } from "../management/use-management";
import { expectedGeneration, startBody, stopBody } from "../plan/requests";
import { ConfirmButton, Notice } from "../ui/kit";

const field =
  "min-w-0 flex-1 rounded-md border border-field bg-white/4 px-2.5 py-1.5 text-xs text-fg placeholder:text-muted";
const message = (result: ManagementLifecycleResult) => result.message;

type Target = {
  instance: string;
  subscription: { product: string; deployed?: string | null };
  health: { label: string };
};

/**
 * Stop or start a deployed instance through the plan and approval flow.
 * Stop needs a reason; start re-applies the recorded pin. A 403 hides both.
 */
export const EnvironmentStopStart = ({
  report,
  token,
  instances,
}: {
  report: EnvironmentInspectReport;
  token: string;
  instances: readonly Target[];
}) => {
  const scope = `environment:${report.name}` as const;
  const path = `v1/environments/${encodeURIComponent(report.name)}`;
  const generation = expectedGeneration(report.lease);
  const call = useManagementCall(token, scope, "management", message);
  const [reason, setReason] = useState("");
  const [picked, setPicked] = useState("");
  const targets = instances.filter((item) => item.subscription.deployed);
  const selected = targets.find((item) => item.instance === picked) ?? targets[0];
  if (selected === undefined) {
    return null;
  }
  const life = selected.health.label;
  const canStop = life !== "stopped" && life !== "starting" && life !== "stopping";
  const canStart = life === "stopped";
  return (
    <>
      {call.allowed ? (
        <div className="flex flex-wrap gap-2 border-t border-line px-3.5 py-3">
          {targets.length > 1 && (
            <select
              aria-label="Instance to stop or start"
              value={selected.instance}
              onChange={(event) => setPicked(event.target.value)}
              className={field}
            >
              {targets.map((item) => (
                <option key={item.instance} value={item.instance}>
                  {item.instance}
                </option>
              ))}
            </select>
          )}
          {canStop && (
            <>
              <input
                aria-label="Stop reason"
                placeholder="Reason to stop"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className={field}
              />
              <ConfirmButton
                label="Stop"
                confirm={`Stop ${selected.instance} on ${report.name}`}
                disabled={!reason.trim() || call.isPending}
                onConfirm={() =>
                  call.mutate({
                    path: `${path}/stop`,
                    body: stopBody(
                      report.name,
                      generation,
                      selected.subscription.product,
                      reason.trim(),
                    ),
                  })
                }
              />
            </>
          )}
          {canStart && (
            <ConfirmButton
              label="Start"
              confirm={`Start ${selected.instance} on ${report.name}`}
              disabled={call.isPending}
              onConfirm={() =>
                call.mutate({
                  path: `${path}/start`,
                  body: startBody(report.name, generation, selected.subscription.product),
                })
              }
            />
          )}
          {life === "stopping" && <p className="m-0 text-warning">Stopping {selected.instance}.</p>}
          {life === "starting" && <p className="m-0 text-warning">Starting {selected.instance}.</p>}
        </div>
      ) : (
        <p className="m-0 border-t border-line px-3.5 py-3 text-xs text-muted">
          No permission to stop or start this instance.
        </p>
      )}
      {call.allowed && call.outcome && (
        <div className="flex flex-wrap items-center gap-2 px-3.5 pb-3">
          <Notice tone={call.outcome.tone}>{call.outcome.text}</Notice>
          {call.outcome.tone === "ok" && (
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
    </>
  );
};
