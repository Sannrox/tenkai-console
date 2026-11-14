import { useState } from "react";
import type { EnvironmentInspectReport, ManagementLifecycleResult } from "../api/tenkai.gen";
import { cancelState } from "../delivery/apply-cancel";
import { useManagementCall } from "../management/use-management";
import { cancelApplyBody } from "../plan/requests";
import { Card, ConfirmButton, Notice } from "../ui/kit";

const field =
  "min-w-0 flex-1 rounded-md border border-field bg-white/4 px-2.5 py-1.5 text-xs text-fg placeholder:text-muted";
const message = (result: ManagementLifecycleResult) => result.message;

/** Cancel the apply holding the environment lease, fenced by its generation. */
export const ApplyCancel = ({
  report,
  token,
}: {
  report: EnvironmentInspectReport;
  token: string;
}) => {
  const environment = report.name;
  const call = useManagementCall(token, `environment:${environment}`, "management", message);
  const [reason, setReason] = useState("");
  const [sent, setSent] = useState<number>();
  const state = cancelState(
    report.lease,
    sent === undefined ? undefined : { generation: sent, accepted: call.isSuccess },
  );
  if (state.kind === "none" && !call.outcome) {
    return null;
  }
  return (
    <section aria-label="Running apply">
      <h2 className="mt-[18px] mb-2 text-[13px] font-semibold">Running apply</h2>
      <Card className="flex flex-col gap-2 px-3.5 py-3 text-xs">
        {state.kind === "running" && (
          <p className="m-0">
            Generation {state.generation} is applying. Cancel lets the current step finish first,
            skips the rest, and holds {environment} until the hold is released.
          </p>
        )}
        {state.kind === "cancelling" && (
          <p className="m-0 text-warning">
            Cancelling generation {state.generation}. The current step finishes first.
          </p>
        )}
        {state.kind === "ended" && (
          <p className="m-0 text-muted">Generation {state.generation} ended.</p>
        )}
        {state.kind === "running" &&
          (call.allowed ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                aria-label="Cancel reason"
                placeholder="Reason, default apply cancelled"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className={field}
              />
              <ConfirmButton
                label="Cancel apply"
                confirm={`Cancel generation ${state.generation} on ${environment}`}
                disabled={call.isPending}
                onConfirm={() => {
                  setSent(state.generation);
                  call.mutate({
                    path: `v1/environments/${encodeURIComponent(environment)}/apply/cancel`,
                    body: cancelApplyBody(environment, state.generation, reason),
                  });
                }}
              />
            </div>
          ) : (
            <p className="m-0 text-muted">No permission to cancel this apply.</p>
          ))}
        {call.outcome && <Notice tone={call.outcome.tone}>{call.outcome.text}</Notice>}
      </Card>
    </section>
  );
};
