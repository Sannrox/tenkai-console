import type { UseQueryResult } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type {
  DeliveryHold,
  DeliveryHoldView,
  EnvironmentInspectReport,
  ManagementLifecycleResult,
} from "../api/tenkai.gen";
import { auditLine, liftLine, recentAudit } from "../delivery/hold";
import { holdLine } from "../delivery/model";
import { useManagementCall } from "../management/use-management";
import {
  expectedGeneration,
  releaseChannelHoldBody,
  retryFailedTargetBody,
} from "../plan/requests";
import { ConfirmButton, Notice } from "../ui/kit";

const field =
  "min-w-0 flex-1 rounded-md border border-field bg-white/4 px-2.5 py-1.5 text-xs text-fg placeholder:text-muted";
const message = (result: ManagementLifecycleResult) => result.message;

/** Hold and retry-held failed-target actions for one subscription row. */
export const SubscriptionHold = ({
  report,
  instance,
  product,
  channel,
  hold,
  failed,
  error,
  token,
}: {
  report: EnvironmentInspectReport;
  instance: string;
  product: string;
  channel: string;
  hold: { actor: string; held_at: number; reason: string } | undefined;
  failed: boolean;
  error: string | null | undefined;
  token: string;
}) => {
  const envScope = `environment:${report.name}` as const;
  const release = useManagementCall(token, "fleet", "management", message);
  const retry = useManagementCall(token, envScope, "management", message);
  const generation = expectedGeneration(report.lease);
  const [retryReason, setRetryReason] = useState("");
  if (!hold && !failed) {
    return <span className="text-muted">none</span>;
  }
  return (
    <div className="flex flex-col gap-1">
      {hold && (
        <>
          <span className="text-warning">{holdLine(hold)}</span>
          {release.allowed && (
            <ConfirmButton
              label="Release hold"
              confirm={`Release hold on ${product}/${channel}`}
              disabled={release.isPending}
              onConfirm={() =>
                release.mutate({
                  path: `v1/products/${encodeURIComponent(product)}/channels/${encodeURIComponent(channel)}/hold/release`,
                  body: releaseChannelHoldBody(),
                })
              }
            />
          )}
          {release.outcome && <Notice tone={release.outcome.tone}>{release.outcome.text}</Notice>}
        </>
      )}
      {failed && (
        <>
          <span className="text-danger">{error ?? "retry held"}</span>
          <Link
            to="/environments"
            search={{ environment: report.name, instance }}
            className="text-xs font-medium text-muted"
          >
            History
          </Link>
          {retry.allowed && (
            <>
              <input
                aria-label={`Retry reason for ${product}`}
                placeholder="Reason to retry"
                value={retryReason}
                onChange={(event) => setRetryReason(event.target.value)}
                className={field}
              />
              <ConfirmButton
                label="Retry"
                confirm={`Retry ${product} on ${report.name}`}
                disabled={!retryReason.trim() || retry.isPending}
                onConfirm={() =>
                  retry.mutate({
                    path: `v1/environments/${encodeURIComponent(report.name)}/failed-targets/${encodeURIComponent(product)}/retry`,
                    body: retryFailedTargetBody(
                      report.name,
                      generation,
                      product,
                      retryReason.trim(),
                    ),
                  })
                }
              />
            </>
          )}
          {retry.outcome && <Notice tone={retry.outcome.tone}>{retry.outcome.text}</Notice>}
        </>
      )}
    </div>
  );
};

/**
 * Environment hold rows for the detail list: who holds it, whether it lifts
 * itself, and the latest set and clear events with their actors, so an
 * automatic hold and an operator hold stay apart.
 */
export const HoldRows = ({
  hold,
  view,
}: {
  hold: DeliveryHold | undefined;
  view: UseQueryResult<DeliveryHoldView>;
}) => {
  const audit = recentAudit(view.data?.audit ?? []);
  return (
    <>
      <dt className="text-muted">delivery hold</dt>
      <dd className={`m-0 wrap-anywhere ${hold ? "text-warning" : "text-muted"}`}>
        {hold ? holdLine(hold) : "none"}
      </dd>
      {hold && view.data && (
        <>
          <dt className="text-muted">lifts</dt>
          <dd className="m-0">{liftLine(hold, view.data.threshold)}</dd>
        </>
      )}
      {view.isError && (
        <>
          <dt className="text-muted">hold history</dt>
          <dd className="m-0 text-muted">Could not load</dd>
        </>
      )}
      {audit.length > 0 && (
        <>
          <dt className="text-muted">hold history</dt>
          <dd className="m-0">
            <ul aria-label="Hold history" className="m-0 list-none p-0 wrap-anywhere">
              {audit.map((event) => (
                <li key={`${event.at}:${event.action}:${event.actor}`}>{auditLine(event)}</li>
              ))}
            </ul>
          </dd>
        </>
      )}
    </>
  );
};
