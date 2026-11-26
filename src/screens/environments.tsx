import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ApiError } from "../api/http";
import type { TickReport } from "../api/tenkai.gen";
import { useSession } from "../auth/session";
import { fleetTableRows } from "../delivery/configuration";
import { useDelivery } from "../delivery/use-delivery";
import { tickLines, tickSummary } from "../management/reconcile";
import { UNKNOWN_OUTCOME, useManagementCall } from "../management/use-management";
import { ActionsMenu, ConfirmButton, Notice, ObjectPage, headingCount } from "../ui/kit";
import { FleetTable } from "./fleet-table";

const TONE = { ok: "text-ok", warn: "text-warning", bad: "text-danger" } as const;

/** Heading count for the Environments landing. */
export const landingStatus = ({
  loading,
  rows,
  behind,
  error,
  unknown,
}: {
  loading: boolean;
  rows: number;
  behind: number;
  error: unknown;
  unknown: boolean;
}): string => {
  if (loading) {
    return "Loading";
  }
  if (unknown) {
    return headingCount(`${rows} environments`, "unknown");
  }
  if (error && rows > 0) {
    return headingCount(`${rows} environments`, "incomplete");
  }
  if (rows === 0) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 405)) {
      return "This server does not report fleet status.";
    }
    if (error) {
      return "The fleet list was not loaded.";
    }
    return "No environments yet.";
  }
  return behind > 0
    ? `${rows} environments, ${behind} behind`
    : `${rows} environments, all current`;
};

/**
 * Environments landing at `/`. FleetTable only. Reconcile lives in Actions.
 * Register stays tenkaictl; this page has no Add environment control.
 */
export const Environments = () => {
  const token = useSession((state) => state.session?.accessToken);
  const navigate = useNavigate({ from: "/" });
  const queryClient = useQueryClient();
  const delivery = useDelivery(token);
  const rows = fleetTableRows(delivery.fleet, delivery.list);
  const failed = Boolean(delivery.error);
  const unavailable =
    rows.length === 0 &&
    delivery.error instanceof ApiError &&
    (delivery.error.status === 404 || delivery.error.status === 405);
  const tick = useManagementCall<TickReport>(token ?? "", "fleet", "management", tickSummary);
  const unknown = tick.outcome?.tone === "unknown";
  const count = landingStatus({
    loading: delivery.loading,
    rows: rows.length,
    behind: delivery.fleet?.environments_behind ?? 0,
    error: delivery.error,
    unknown,
  });
  const retry = () => {
    void queryClient.invalidateQueries({ queryKey: ["fleet", token] });
    void queryClient.invalidateQueries({ queryKey: ["environments", token] });
  };
  const showRetry = failed && !unavailable;
  const showReconcile = tick.allowed && rows.length > 0;
  const showActions =
    token !== undefined && !delivery.loading && (showRetry || showReconcile || unknown);
  return (
    <ObjectPage
      name="Environments"
      status={count}
      actions={
        showActions ? (
          <ActionsMenu
            needed={showRetry || unknown}
            status={unknown ? UNKNOWN_OUTCOME : undefined}
            items={showRetry ? [{ label: "Retry", onClick: retry }] : undefined}
          >
            {showReconcile && (
              <ConfirmButton
                label="Reconcile"
                confirm="Run one reconcile tick"
                disabled={tick.isPending}
                onConfirm={() => tick.mutate({ path: "v1/reconcile" })}
              />
            )}
          </ActionsMenu>
        ) : undefined
      }
    >
      {tick.outcome && tick.outcome.tone !== "unknown" && (
        <Notice tone={tick.outcome.tone}>{tick.outcome.text}</Notice>
      )}
      {tick.data &&
        tickLines(tick.data).map((line) => (
          <div key={line.environment} className="text-xs">
            <b className="font-semibold">{line.environment}</b>{" "}
            <span className={TONE[line.tone]}>{line.text}</span>
          </div>
        ))}
      {!delivery.loading && rows.length > 0 && (
        <FleetTable
          rows={rows}
          label="Environments"
          onSelect={(name) => {
            void navigate({ to: "/environments/$environment", params: { environment: name } });
          }}
        />
      )}
    </ObjectPage>
  );
};
