import type { TickReport } from "../api/tenkai.gen";
import { useSession } from "../auth/session";
import { attention } from "../delivery/model";
import { useDelivery } from "../delivery/use-delivery";
import { tickLines, tickSummary } from "../management/reconcile";
import { refusesCredential, useManagementCall } from "../management/use-management";
import { ConfirmButton, Notice } from "../ui/kit";
import { Delivery } from "./delivery";

const TONE = { ok: "text-ok", warn: "text-warning", bad: "text-danger" } as const;

/** Signed-in landing: the delivery matrix (decision 2B) and one reconcile tick on request. */
export const Home = () => {
  const token = useSession((state) => state.session?.accessToken);
  const delivery = useDelivery(token);
  const needs = attention(delivery.reports).length;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="m-0 text-lg font-semibold">Delivery</h1>
        <span className="text-xs text-muted">
          {delivery.error
            ? delivery.error.message
            : delivery.loading
              ? "Loading"
              : needs === 0
                ? `${delivery.reports.length} environments, all current`
                : `${needs} need attention`}
        </span>
        {token && <Reconcile token={token} />}
      </div>
      {!delivery.loading && !delivery.error && <Delivery reports={delivery.reports} />}
    </>
  );
};

/**
 * Requests one reconcile tick and shows the server's report. The environment
 * reads refresh once it settles; a lost response stays unknown until then.
 */
const Reconcile = ({ token }: { token: string }) => {
  const tick = useManagementCall<TickReport>(token, "fleet", tickSummary);
  const refused = refusesCredential(tick.error);
  if (!tick.allowed && !refused) {
    return null;
  }
  return (
    <div className="ml-auto flex flex-col items-end gap-1 text-xs">
      {tick.allowed && (
        <div className="flex gap-2">
          <ConfirmButton
            label="Reconcile"
            confirm="Run one reconcile tick"
            disabled={tick.isPending}
            onConfirm={() => tick.mutate({ path: "v1/reconcile" })}
          />
        </div>
      )}
      {tick.outcome && <Notice tone={tick.outcome.tone}>{tick.outcome.text}</Notice>}
      {tick.data &&
        tickLines(tick.data).map((line) => (
          <div key={line.environment}>
            <b className="font-semibold">{line.environment}</b>{" "}
            <span className={TONE[line.tone]}>{line.text}</span>
          </div>
        ))}
    </div>
  );
};
