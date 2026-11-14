import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type {
  EnvironmentInspectReport,
  ManagementLifecycleResult,
  RetireEnvironmentRequest,
} from "../api/tenkai.gen";
import { useSession } from "../auth/session";
import { channelMatrix, fleetTableRows } from "../delivery/configuration";
import { deployedLabel, heldAtLine, heldProducts, waitingLine } from "../delivery/dependencies";
import type { StatusRow } from "../delivery/identity";
import { healthRollup, instanceName, withHealth } from "../delivery/instances";
import {
  maintenanceDetail,
  maintenanceRefreshAt,
  maintenanceTimeline,
  type MaintenanceTimeline,
} from "../delivery/maintenance";
import { isHeldFailedTarget, productHasActivePlan } from "../delivery/model";
import {
  DOWNGRADE_NOTICE,
  previousRelease,
  rollbackConfirmed,
  rollbackSummary,
} from "../delivery/rollback";
import {
  useDelivery,
  useEnvironmentDependencies,
  useEnvironmentHold,
  useEnvironmentInspect,
  useEnvironmentStatus,
} from "../delivery/use-delivery";
import { useManagementCall } from "../management/use-management";
import {
  expectedGeneration,
  holdBody,
  releaseHoldBody,
  rollbackBody,
  subscribeBody,
} from "../plan/requests";
import { Button, Card, ConfirmButton, Notice } from "../ui/kit";
import { AddEnvironment, ConfigSections } from "./environment-config";
import { HoldRows, SubscriptionHold } from "./environment-hold";
import { Runtime } from "./environment-runtime";
import { FleetTable } from "./fleet-table";
import { HealthChecks } from "./health-checks";

const EnvironmentDependencies = lazy(() => import("./environment-dependencies"));
const EnvironmentHistory = lazy(() => import("./environment-history"));
const InstanceExplain = lazy(() => import("./instance-explain"));

const th = "border-b border-line px-3.5 py-2 text-left font-medium whitespace-nowrap text-muted";
const td = "border-b border-line px-3.5 py-2 align-top";

/**
 * Decision 4D: environments as a top tab, one table, the selected row's detail
 * below. The detail shows observed runtime, subscribes a product channel,
 * rolls back, and retires.
 */
export const Environments = ({
  focus,
  instance: historyInstance,
}: {
  focus?: string;
  instance?: string;
}) => {
  const token = useSession((state) => state.session?.accessToken);
  const navigate = useNavigate({ from: "/environments" });
  const delivery = useDelivery(token);
  const rows = fleetTableRows(delivery.fleet, delivery.list);
  const shown = rows.some((row) => row.name === focus) ? focus : rows[0]?.name;
  const inspect = useEnvironmentInspect(token, shown);
  const report = inspect.data;
  const known = channelMatrix(delivery.channels);
  const select = (name: string) => {
    void navigate({ search: { environment: name }, replace: true });
  };
  const selectInstance = (value: string | undefined) => {
    void navigate({
      search: {
        ...(shown === undefined ? {} : { environment: shown }),
        ...(value === undefined ? {} : { instance: value }),
      },
      replace: true,
    });
  };

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
      <FleetTable rows={rows} selected={shown} onSelect={select} label="Environments" />
      {inspect.error && (
        <div className="mt-3">
          <Notice tone="bad">
            {inspect.error instanceof Error ? inspect.error.message : String(inspect.error)}
          </Notice>
        </div>
      )}
      {inspect.isLoading && <p className="mt-3 text-xs text-muted">Loading</p>}
      {report && token !== undefined && (
        <Detail
          key={report.name}
          report={report}
          token={token}
          known={{ products: known.products, channels: known.channels }}
          {...(historyInstance === undefined ? {} : { historyInstance })}
          onInstance={selectInstance}
        />
      )}
    </>
  );
};

const field =
  "min-w-0 flex-1 rounded-md border border-field bg-white/4 px-2.5 py-1.5 text-xs text-fg placeholder:text-muted";
const message = (result: ManagementLifecycleResult) => result.message;

const Detail = ({
  report,
  token,
  known,
  historyInstance,
  onInstance,
}: {
  report: EnvironmentInspectReport;
  token: string;
  known: { products: string[]; channels: string[] };
  historyInstance?: string;
  onInstance: (instance: string | undefined) => void;
}) => {
  const scope = `environment:${report.name}` as const;
  const path = `v1/environments/${encodeURIComponent(report.name)}`;
  const generation = expectedGeneration(report.lease);
  const now = useMinuteClock();
  const timeline = maintenanceTimeline(report, now);
  useRefreshAt(maintenanceRefreshAt(report), now, ["environment", report.name, token]);
  const retire = useManagementCall(token, scope, "management", message);
  const rollback = useManagementCall(token, scope, "management", message);
  const subscribe = useManagementCall(token, scope, "management", message);
  const hold = useManagementCall(token, scope, "management", message);
  const [reason, setReason] = useState("");
  const [holdReason, setHoldReason] = useState("");
  const [product, setProduct] = useState("");
  const [channel, setChannel] = useState("");
  const [explain, setExplain] = useState<string | undefined>();
  const deployed = report.subscriptions.filter((subscription) => subscription.deployed);
  const [rollbackProduct, setRollbackProduct] = useState(deployed[0]?.product ?? "");
  const selectedProduct = deployed.some((subscription) => subscription.product === rollbackProduct)
    ? rollbackProduct
    : (deployed[0]?.product ?? "");
  const previous = previousRelease(report, selectedProduct);
  const spec = `${product.trim()}=${channel.trim()}`;
  const dependencies = useEnvironmentDependencies(token, report.name);
  const status = useEnvironmentStatus(token, report.name);
  const holdView = useEnvironmentHold(token, report.name);
  const holds = dependencies.data?.kind === "ok" ? dependencies.data.value.holds : [];
  const waiting = heldProducts(holds);
  const nowSecs = Math.floor(now / 1000);
  let identityRefreshAt: number | undefined;
  if (status.data?.kind === "ok") {
    for (const row of status.data.value) {
      const expires = row.certificate?.expires_at;
      if (expires === undefined) {
        continue;
      }
      const ms = expires * 1000;
      if (identityRefreshAt === undefined || ms < identityRefreshAt) {
        identityRefreshAt = ms;
      }
    }
  }
  useRefreshAt(identityRefreshAt, now, ["status", report.name, token]);
  const instances = withHealth(
    report.subscriptions,
    status.data?.kind === "ok" ? status.data.value : undefined,
  );
  const rollup = healthRollup(instances.map((item) => item.health));

  return (
    <>
      <div className="mt-[18px] mb-2 flex items-baseline gap-2 text-[13px] font-semibold">
        {report.name}
        <span className="font-mono text-[11px] font-medium text-muted">{report.description}</span>
        <Link
          to="/environments/$environment/plan"
          params={{ environment: report.name }}
          className="ml-auto text-xs font-medium text-muted"
        >
          Open plan
        </Link>
      </div>
      <div className="grid min-w-0 gap-3 md:grid-cols-2">
        <Card className="min-w-0 overflow-x-auto">
          {report.subscriptions.length === 0 ? (
            <p className="m-0 px-3.5 py-3 text-xs text-muted">none</p>
          ) : (
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr>
                  <th className={th}>Instance</th>
                  <th className={th}>Product</th>
                  <th className={th}>Channel</th>
                  <th className={th}>Deployed</th>
                  <th className={th}>Head</th>
                  <th className={th}>Health</th>
                  <th className={th}>Identity</th>
                  <th className={th}>Previous</th>
                  <th className={th}>Hold</th>
                </tr>
              </thead>
              <tbody>
                {instances.map(({ subscription, instance, row, health }) => {
                  const identity =
                    status.data?.kind === "ok"
                      ? identityLabel(row, nowSecs)
                      : { label: "n/a", tone: "muted" as const };
                  const held = waiting.has(instance) || waiting.has(subscription.product);
                  return (
                    <tr key={instance} className="[&:last-child>td]:border-b-0">
                      <td className={`${td} font-mono`}>{instance}</td>
                      <td className={td}>{subscription.product}</td>
                      <td className={td}>{subscription.channel}</td>
                      <td
                        className={`${td} font-mono ${held || subscription.state !== "current" ? "text-warning" : "text-ok"}`}
                      >
                        {deployedLabel(subscription.deployed, held)}
                      </td>
                      <td className={`${td} font-mono whitespace-nowrap`}>
                        {subscription.head}
                        {subscription.state !== "current" && (
                          <button
                            type="button"
                            className="ml-2 cursor-pointer font-sans font-semibold text-muted"
                            aria-label={`Why is ${instance} behind`}
                            aria-pressed={explain === instance}
                            onClick={() => setExplain(explain === instance ? undefined : instance)}
                          >
                            Why
                          </button>
                        )}
                      </td>
                      <td className={`${td} ${HEALTH_TONE[health.tone]}`}>
                        {health.label}
                        <HealthChecks checks={health.checks} />
                      </td>
                      <td className={`${td} ${HEALTH_TONE[identity.tone]}`}>{identity.label}</td>
                      <td className={`${td} font-mono text-muted`}>
                        {previousRelease(report, subscription.product) ?? "none"}
                      </td>
                      <td className={td}>
                        <SubscriptionHold
                          report={report}
                          instance={instanceName(subscription)}
                          product={subscription.product}
                          channel={subscription.channel}
                          hold={subscription.delivery_hold}
                          failed={
                            isHeldFailedTarget(subscription) &&
                            !productHasActivePlan(report.latest_plan, subscription.product)
                          }
                          error={subscription.error}
                          token={token}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {subscribe.allowed && (
            <div className="flex flex-wrap gap-2 border-t border-line px-3.5 py-3">
              <input
                aria-label="Product"
                placeholder="Product"
                list="known-products"
                value={product}
                onChange={(event) => setProduct(event.target.value)}
                className={field}
              />
              <input
                aria-label="Channel"
                placeholder="Channel"
                list="known-channels"
                value={channel}
                onChange={(event) => setChannel(event.target.value)}
                className={field}
              />
              <datalist id="known-products">
                {known.products.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              <datalist id="known-channels">
                {known.channels.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              <ConfirmButton
                label="Subscribe"
                confirm={`Subscribe ${report.name} to ${spec}`}
                disabled={!product.trim() || !channel.trim() || subscribe.isPending}
                onConfirm={() =>
                  subscribe.mutate({
                    path: `${path}/subscriptions`,
                    body: subscribeBody(report.name, generation, product.trim(), channel.trim()),
                  })
                }
              />
            </div>
          )}
          {subscribe.outcome && (
            <div className="px-3.5 pb-3">
              <Notice tone={subscribe.outcome.tone}>{subscribe.outcome.text}</Notice>
            </div>
          )}
        </Card>
        <Card className="min-w-0 overflow-x-auto">
          {timeline && <TimelineStrip timeline={timeline} />}
          <dl className="m-0 grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 px-3.5 py-3 text-xs">
            {Object.entries(report.facts).map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-muted">{key}</dt>
                <dd className="m-0">{value}</dd>
              </div>
            ))}
            <dt className="text-muted">health</dt>
            <dd className={`m-0 ${HEALTH_TONE[rollup.tone]}`}>{rollup.label}</dd>
            <dt className="text-muted">lease</dt>
            <dd className="m-0">
              {report.lease.held ? `held, generation ${report.lease.generation ?? 0}` : "free"}
            </dd>
            <HoldRows hold={report.delivery_hold} view={holdView} />
            {holds.length > 0 && (
              <>
                <dt className="text-muted">waiting</dt>
                <dd className="m-0 text-warning">{waitingLine(holds)}</dd>
                <dt className="text-muted">held at</dt>
                <dd className="m-0 font-mono">{heldAtLine(holds)}</dd>
              </>
            )}
            {(timeline?.rows ?? maintenanceDetail(report)).map((row) => (
              <div key={`${row.label}:${row.value}`} className="contents">
                <dt className="text-muted">{row.label}</dt>
                <dd className={`m-0 ${row.label === "waiting" ? "text-warning" : ""}`}>
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
          {hold.allowed && (
            <div className="flex flex-wrap gap-2 border-t border-line px-3.5 py-3">
              {report.delivery_hold ? (
                <ConfirmButton
                  label="Release hold"
                  confirm={`Release hold on ${report.name}`}
                  disabled={hold.isPending}
                  onConfirm={() =>
                    hold.mutate({
                      path: `${path}/hold/release`,
                      body: releaseHoldBody(report.name, generation),
                    })
                  }
                />
              ) : (
                <>
                  <input
                    aria-label="Hold reason"
                    placeholder="Reason to hold"
                    value={holdReason}
                    onChange={(event) => setHoldReason(event.target.value)}
                    className={field}
                  />
                  <ConfirmButton
                    label="Hold"
                    confirm={`Hold ${report.name}`}
                    disabled={!holdReason.trim() || hold.isPending}
                    onConfirm={() =>
                      hold.mutate({
                        path: `${path}/hold`,
                        body: holdBody(report.name, generation, holdReason.trim()),
                      })
                    }
                  />
                </>
              )}
            </div>
          )}
          {hold.outcome && (
            <div className="px-3.5 pb-3">
              <Notice tone={hold.outcome.tone}>{hold.outcome.text}</Notice>
            </div>
          )}
          {rollback.allowed && deployed.length > 0 && (
            <div className="flex flex-wrap gap-2 border-t border-line px-3.5 py-3">
              {deployed.length > 1 && (
                <select
                  aria-label="Product to roll back"
                  value={selectedProduct}
                  onChange={(event) => setRollbackProduct(event.target.value)}
                  className={field}
                >
                  {deployed.map((subscription) => (
                    <option key={subscription.product} value={subscription.product}>
                      {subscription.product}
                    </option>
                  ))}
                </select>
              )}
              <RollbackDialog
                environment={report.name}
                summary={rollbackSummary(report, selectedProduct, previous)}
                disabled={!selectedProduct || rollback.isPending}
                onConfirm={(why) =>
                  rollback.mutate({
                    path: `${path}/rollback`,
                    body: rollbackBody(report.name, generation, selectedProduct, why),
                  })
                }
              />
            </div>
          )}
          {rollback.outcome && (
            <div className="flex flex-wrap items-center gap-2 px-3.5 pb-3">
              <Notice tone={rollback.outcome.tone}>{rollback.outcome.text}</Notice>
              {rollback.outcome.tone === "ok" && (
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
          {retire.allowed && (
            <div className="flex gap-2 border-t border-line px-3.5 py-3">
              <input
                aria-label="Retirement reason"
                placeholder="Reason to retire"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className={field}
              />
              <Button
                disabled={!reason.trim() || retire.isPending}
                onClick={() =>
                  retire.mutate({
                    path: `${path}/retire`,
                    body: {
                      version: 1,
                      operation: "retire",
                      reason,
                    } satisfies RetireEnvironmentRequest,
                  })
                }
              >
                Retire
              </Button>
            </div>
          )}
          {retire.outcome && (
            <div className="px-3.5 pb-3">
              <Notice tone={retire.outcome.tone}>{retire.outcome.text}</Notice>
            </div>
          )}
        </Card>
      </div>
      {explain !== undefined && (
        <Suspense fallback={<p className="mt-3 text-xs text-muted">Loading</p>}>
          <InstanceExplain
            key={explain}
            environment={report.name}
            instance={explain}
            token={token}
            onClose={() => setExplain(undefined)}
          />
        </Suspense>
      )}
      <Suspense fallback={<p className="mt-3 text-xs text-muted">Loading</p>}>
        <EnvironmentDependencies
          environment={report.name}
          token={token}
          subscriptions={report.subscriptions}
        />
      </Suspense>
      <Suspense fallback={<p className="mt-3 text-xs text-muted">Loading</p>}>
        <EnvironmentHistory
          environment={report.name}
          report={report}
          token={token}
          now={now}
          instances={[
            ...new Set(report.subscriptions.map((subscription) => instanceName(subscription))),
          ]}
          {...(status.data === undefined ? {} : { identity: status.data })}
          {...(historyInstance === undefined ? {} : { instance: historyInstance })}
          onInstance={onInstance}
        />
      </Suspense>
      <ConfigSections report={report} token={token} holdView={holdView.data} />
      <Runtime report={report} token={token} />
    </>
  );
};

const HEALTH_TONE = {
  ok: "text-ok",
  warn: "text-warning",
  bad: "text-danger",
  muted: "text-muted",
} as const;

/** Status `certificate` on the instance list; kept here so identity GET stays lazy. */
const identityLabel = (
  row: StatusRow | undefined,
  nowSecs: number,
): { label: string; tone: keyof typeof HEALTH_TONE } => {
  const certificate = row?.certificate;
  if (certificate === null || certificate === undefined) {
    return { label: "none", tone: "muted" };
  }
  if (certificate.expires_at <= nowSecs) {
    return { label: "expired", tone: "bad" };
  }
  if (certificate.near_expiry) {
    return { label: "near expiry", tone: "warn" };
  }
  if ((certificate.renewal_failure ?? "").trim() !== "") {
    return { label: "renewing", tone: "warn" };
  }
  return { label: "valid", tone: "ok" };
};

/** Seven days of maintenance windows in local time, four slots a day. */
function TimelineStrip({ timeline }: { timeline: MaintenanceTimeline }) {
  return (
    <div className="border-b border-line px-3.5 py-3 text-xs">
      <span className="text-muted">Next 7 days, local time</span>
      <ul
        className="m-0 mt-1.5 grid list-none grid-cols-[repeat(28,1fr)] gap-px p-0"
        aria-label="Maintenance windows, next 7 days"
      >
        {timeline.slots.map((slot, index) => (
          <li
            // oxlint-disable-next-line no-array-index-key -- slots are positional
            key={index}
            aria-label={slot.label}
            title={slot.label}
            className={`block h-3 ${slot.open ? "bg-ok" : "bg-line"} ${slot.now ? "outline outline-1 outline-fg" : ""}`}
          />
        ))}
      </ul>
      <div className="mt-1 grid grid-cols-7 text-muted" aria-hidden="true">
        <span>{timeline.days[0]}</span>
        <span />
        <span>{timeline.days[1]}</span>
        <span />
        <span>{timeline.days[2]}</span>
      </div>
    </div>
  );
}

/** The current time, refreshed every minute, for time-relative views. */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * Refetch `queryKey` once `at` passes, at once when it already has, and
 * again every minute (`now` is the minute clock) while it stays overdue, so
 * a failed refresh is retried.
 */
function useRefreshAt(at: number | undefined, now: number, queryKey: readonly unknown[]): void {
  const client = useQueryClient();
  const key = JSON.stringify(queryKey);
  const overdueTick = at !== undefined && at <= now ? now : 0;
  useEffect(() => {
    if (at === undefined) {
      return undefined;
    }
    // Overdue: retry a second after each minute tick; else just past `at`.
    const delay = overdueTick > 0 ? 1_000 : Math.max(0, at - Date.now()) + 1_000;
    const timer = setTimeout(
      () => void client.invalidateQueries({ queryKey: JSON.parse(key) as unknown[] }),
      delay,
    );
    return () => clearTimeout(timer);
  }, [at, overdueTick, key, client]);
}

/**
 * Roll back behind a modal (#28, pick B): it states what will happen, takes
 * a reason, and sends only once the environment name is typed exactly.
 */
function RollbackDialog({
  environment,
  summary,
  disabled,
  onConfirm,
}: {
  environment: string;
  summary: Array<{ label: string; value: string }>;
  disabled: boolean;
  onConfirm: (reason: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const close = () => {
    dialog.current?.close();
    setReason("");
    setTyped("");
  };
  return (
    <>
      <Button disabled={disabled} onClick={() => dialog.current?.showModal()}>
        Roll back
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby={`rollback-${environment}`}
        onClose={() => {
          setReason("");
          setTyped("");
        }}
        className="m-auto w-full max-w-[380px] rounded-card border border-line bg-card p-3 text-xs text-fg backdrop:bg-black/70"
      >
        <p id={`rollback-${environment}`} className="m-0 mb-2 text-sm font-semibold">
          Roll back {environment}?
        </p>
        <dl className="m-0 mb-2 grid grid-cols-[90px_1fr] gap-x-3 gap-y-1">
          {summary.map((row) => (
            <div key={row.label} className="contents">
              <dt className="text-muted">{row.label}</dt>
              <dd className={`m-0 ${row.label === "approval" ? "text-warning" : ""}`}>
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
        <p className="m-0 mb-2 text-muted">{DOWNGRADE_NOTICE}</p>
        <label className="mb-2 block">
          <span className="text-muted">Reason</span>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className={`${field} mt-1 w-full`}
          />
        </label>
        <label className="mb-3 block">
          <span className="text-muted">Type {environment} to confirm</span>
          <input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            className={`${field} mt-1 w-full`}
          />
        </label>
        <div className="flex gap-2">
          <Button
            variant="primary"
            disabled={disabled || !rollbackConfirmed(environment, typed, reason)}
            onClick={() => {
              onConfirm(reason.trim());
              close();
            }}
          >
            Roll back
          </Button>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
        </div>
      </dialog>
    </>
  );
}
