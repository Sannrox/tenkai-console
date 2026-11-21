import { Navigate, useNavigate } from "@tanstack/react-router";
import { useSession } from "../auth/session";
import { fleetTableRows } from "../delivery/configuration";
import { useDelivery } from "../delivery/use-delivery";
import { AddEnvironment } from "./environment-config";
import { FleetTable } from "./fleet-table";

/**
 * Environments list. `?environment=` and `?instance=` deep links open the
 * object page (History when an instance is named).
 */
export const Environments = ({ focus, instance }: { focus?: string; instance?: string }) => {
  const token = useSession((state) => state.session?.accessToken);
  const navigate = useNavigate({ from: "/environments" });
  const delivery = useDelivery(token);
  const rows = fleetTableRows(delivery.fleet, delivery.list);
  if (focus !== undefined) {
    return (
      <Navigate
        to={
          instance === undefined
            ? "/environments/$environment"
            : "/environments/$environment/history"
        }
        params={{ environment: focus }}
        search={instance === undefined ? {} : { instance }}
        replace
      />
    );
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="m-0 text-lg font-semibold">Environments</h1>
        <span className="text-xs text-muted">
          {delivery.error
            ? delivery.error.message
            : delivery.loading
              ? "Loading"
              : `${rows.length} active`}
        </span>
        {token !== undefined && <AddEnvironment token={token} />}
      </div>
      <FleetTable
        rows={rows}
        label="Environments"
        onSelect={(name) => {
          void navigate({ to: "/environments/$environment", params: { environment: name } });
        }}
      />
    </>
  );
};
