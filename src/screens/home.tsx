import type { TickReport } from "../api/tenkai.gen";
import { useSession } from "../auth/session";
import { fleetAttention, fleetTableRows } from "../delivery/configuration";
import { useDelivery } from "../delivery/use-delivery";
import { tickLines, tickSummary } from "../management/reconcile";
import { refusesCredential, useManagementCall } from "../management/use-management";
import { ConfirmButton, Notice } from "../ui/kit";
import { Delivery } from "./delivery";

const TONE = { ok: "text-ok", warn: "text-warning", bad: "text-danger" } as const;

/** Signed-in landing: fleet counts from bulk routes and one reconcile tick on request. */
export const Home = () => {
  const token = useSession((state) => state.session?.accessToken);
  const delivery = useDelivery(token);
  const rows = fleetTableRows(delivery.fleet, delivery.list);
  const items = fleetAttention(delivery.fleet?.environments ?? []);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="m-0 text-lg font-semibold">Delivery</h1>
        <span className="text-xs text-muted">
          {delivery.error
            ? delivery.error.message
            : delivery.loading
              ? "Loading"
              : items.length > 0
                ? `${items.length} need attention`
                : delivery.fleet && delivery.fleet.environments_behind > 0
                  ? `${rows.length} environments, ${delivery.fleet.environments_behind} behind`
                  : `${rows.length} environments, all current`}
        </span>
        {token && <Reconcile token={token} />}
      </div>
      {!delivery.loading && !delivery.error && (
        <Delivery rows={rows} items={items} fleet={delivery.fleet} />
      )}
    </>
  );
};

/**
 * Requests one reconcile tick and shows the server's report. The environment
 * reads refresh once it settles; a lost response stays unknown until then.
 */
const Reconcile = ({ token }: { token: string }) => {
  const tick = useManagementCall<TickReport>(token, "fleet", "management", tickSummary);
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
