import { useQueryClient } from "@tanstack/react-query";
import { Navigate, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useSession } from "../auth/session";
import { fleetTableRows } from "../delivery/configuration";
import { useDelivery } from "../delivery/use-delivery";
import { ActionsMenu, ObjectPage, headingCount } from "../ui/kit";
import { AddEnvironment } from "./environment-config";
import { FleetTable } from "./fleet-table";

/**
 * Environments list. `?environment=` and `?instance=` deep links open the
 * object page (History when an instance is named).
 */
export const Environments = ({ focus, instance }: { focus?: string; instance?: string }) => {
  const token = useSession((state) => state.session?.accessToken);
  const navigate = useNavigate({ from: "/environments" });
  const queryClient = useQueryClient();
  const delivery = useDelivery(token);
  const rows = fleetTableRows(delivery.fleet, delivery.list);
  const [adding, setAdding] = useState(false);
  const failed = delivery.error !== undefined;
  const incomplete = failed && rows.length > 0;
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

  const count = delivery.loading
    ? "Loading"
    : incomplete
      ? headingCount(`${rows.length} environments`, "incomplete")
      : delivery.error
        ? delivery.error.message
        : `${rows.length} active`;
  const retry = () => {
    void queryClient.invalidateQueries({ queryKey: ["fleet", token] });
    void queryClient.invalidateQueries({ queryKey: ["environments", token] });
  };
  return (
    <ObjectPage
      name="Environments"
      status={count}
      actions={
        <ActionsMenu
          needed={incomplete || failed}
          items={[
            ...(failed ? [{ label: "Retry", onClick: retry }] : []),
            ...(token !== undefined
              ? [{ label: "Add environment", onClick: () => setAdding(true) }]
              : []),
          ]}
        />
      }
    >
      {token !== undefined && <AddEnvironment token={token} open={adding} onOpen={setAdding} />}
      <FleetTable
        rows={rows}
        label="Environments"
        onSelect={(name) => {
          void navigate({ to: "/environments/$environment", params: { environment: name } });
        }}
      />
    </ObjectPage>
  );
};
