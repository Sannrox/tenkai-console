import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { request } from "../api/http";
import type {
  EnvironmentInspectReport,
  EnvironmentRuntimeReport,
  ManagementLifecycleResult,
  RetireEnvironmentRequest,
} from "../api/tenkai.gen";
import { useSession } from "../auth/session";
import { channelTable, environmentRows } from "../delivery/configuration";
import {
  maintenanceDetail,
  maintenanceRefreshAt,
  maintenanceTimeline,
  type MaintenanceTimeline,
} from "../delivery/maintenance";
import { holdLine, isHeldFailedTarget, productHasActivePlan } from "../delivery/model";
import { DOWNGRADE_NOTICE, previousRelease, rollbackConfirm } from "../delivery/rollback";
import { runtimeRows } from "../delivery/runtime";
import { useDelivery } from "../delivery/use-delivery";
import { useManagementCall } from "../management/use-management";
import {
  expectedGeneration,
  holdBody,
  releaseChannelHoldBody,
  releaseHoldBody,
  retryFailedTargetBody,
  rollbackBody,
  subscribeBody,
} from "../plan/requests";
import { Button, Card, ConfirmButton, Notice } from "../ui/kit";

const th = "border-b border-line px-3.5 py-2 text-left font-medium whitespace-nowrap text-muted";
const td = "border-b border-line px-3.5 py-2 align-top";

/**
 * Decision 4D: environments as a top tab, one table, the selected row's detail
 * below. The detail shows observed runtime, subscribes a product channel,
 * rolls back, and retires.
 */
export const Environments = ({ focus }: { focus?: string }) => {
  const token = useSession((state) => state.session?.accessToken);
  const navigate = useNavigate({ from: "/environments" });
  const delivery = useDelivery(token);
  const rows = environmentRows(delivery.reports);
  const shown = rows.some((row) => row.name === focus) ? focus : rows[0]?.name;
  const report = delivery.reports.find((candidate) => candidate.name === shown);
  const { products, channels } = channelTable(delivery.reports);
  const select = (name: string) => {
    void navigate({ search: { environment: name }, replace: true });
  };

  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="m-0 text-lg font-semibold">Environments</h1>
        <span className="text-xs text-muted">
          {delivery.error
            ? delivery.error.message
            : delivery.loading
              ? "Loading"
              : `${rows.length} active`}
        </span>
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className={th}>Environment</th>
              <th className={th}>Channels</th>
              <th className={th}>Deployed</th>
              <th className={th}>Facts</th>
              <th className={th}>Lease</th>
              <th className={th}>Hold</th>
              <th className={th}>Latest plan</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.name}
                aria-selected={row.name === report?.name}
                onClick={() => select(row.name)}
                className={`cursor-pointer [&:last-child>td]:border-b-0 ${row.name === report?.name ? "bg-selected" : ""}`}
              >
                <td className={`${td} font-semibold`}>{row.name}</td>
                <td className={td}>{row.channels.join(", ") || "none"}</td>
                <td className={`${td} font-mono`}>
                  {row.deployed}/{row.subscribed}
                </td>
                <td className={`${td} text-muted`}>{row.facts || "none"}</td>
                <td className={td}>{row.lease}</td>
                <td className={`${td} ${row.hold ? "text-warning" : "text-muted"}`}>
                  {row.hold ?? "none"}
                </td>
                <td className={td}>{row.plan}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {report && token && (
        <Detail key={report.name} report={report} token={token} known={{ products, channels }} />
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
}: {
  report: EnvironmentInspectReport;
  token: string;
  known: { products: string[]; channels: string[] };
}) => {
  const scope = `environment:${report.name}` as const;
  const path = `v1/environments/${encodeURIComponent(report.name)}`;
  const generation = expectedGeneration(report.lease);
  const now = useMinuteClock();
  const timeline = maintenanceTimeline(report, now);
  useRefreshAt(maintenanceRefreshAt(report, now), ["environment", report.name, token]);
  const retire = useManagementCall(token, scope, "management", message);
  const rollback = useManagementCall(token, scope, "management", message);
  const subscribe = useManagementCall(token, scope, "management", message);
  const hold = useManagementCall(token, scope, "management", message);
  const [reason, setReason] = useState("");
  const [rollbackReason, setRollbackReason] = useState("");
  const [holdReason, setHoldReason] = useState("");
  const [product, setProduct] = useState("");
  const [channel, setChannel] = useState("");
  const deployed = report.subscriptions.filter((subscription) => subscription.deployed);
  const [rollbackProduct, setRollbackProduct] = useState(deployed[0]?.product ?? "");
  const selectedProduct = deployed.some((subscription) => subscription.product === rollbackProduct)
    ? rollbackProduct
    : (deployed[0]?.product ?? "");
  const previous = previousRelease(report, selectedProduct);
  const spec = `${product.trim()}=${channel.trim()}`;

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
      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className={th}>Product</th>
                <th className={th}>Channel</th>
                <th className={th}>Deployed</th>
                <th className={th}>Head</th>
                <th className={th}>Previous</th>
                <th className={th}>Hold</th>
              </tr>
            </thead>
            <tbody>
              {report.subscriptions.map((subscription) => (
                <tr key={subscription.product} className="[&:last-child>td]:border-b-0">
                  <td className={td}>{subscription.product}</td>
                  <td className={td}>{subscription.channel}</td>
                  <td
                    className={`${td} font-mono ${subscription.state === "current" ? "text-ok" : "text-warning"}`}
                  >
                    {subscription.deployed ?? "none"}
                  </td>
                  <td className={`${td} font-mono`}>{subscription.head}</td>
                  <td className={`${td} font-mono text-muted`}>
                    {previousRelease(report, subscription.product) ?? "none"}
                  </td>
                  <td className={td}>
                    <SubscriptionHold
                      report={report}
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
              ))}
            </tbody>
          </table>
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
        <Card>
          {timeline && <TimelineStrip timeline={timeline} />}
          <dl className="m-0 grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 px-3.5 py-3 text-xs">
            {Object.entries(report.facts).map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-muted">{key}</dt>
                <dd className="m-0">{value}</dd>
              </div>
            ))}
            <dt className="text-muted">lease</dt>
            <dd className="m-0">
              {report.lease.held ? `held, generation ${report.lease.generation ?? 0}` : "free"}
            </dd>
            <dt className="text-muted">delivery hold</dt>
            <dd className={`m-0 ${report.delivery_hold ? "text-warning" : "text-muted"}`}>
              {report.delivery_hold ? holdLine(report.delivery_hold) : "none"}
            </dd>
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
            <div className="border-t border-line px-3.5 py-3">
              <div className="flex flex-wrap gap-2">
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
                <input
                  aria-label="Rollback reason"
                  placeholder="Reason"
                  value={rollbackReason}
                  onChange={(event) => setRollbackReason(event.target.value)}
                  className={field}
                />
                <ConfirmButton
                  label="Roll back"
                  confirm={rollbackConfirm(selectedProduct, previous)}
                  disabled={!selectedProduct || !rollbackReason.trim() || rollback.isPending}
                  onConfirm={() =>
                    rollback.mutate({
                      path: `${path}/rollback`,
                      body: rollbackBody(
                        report.name,
                        generation,
                        selectedProduct,
                        rollbackReason.trim(),
                      ),
                    })
                  }
                />
              </div>
              <p className="mt-2 mb-0 text-xs text-muted">{DOWNGRADE_NOTICE}</p>
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
      <Runtime report={report} token={token} />
    </>
  );
};

const HEALTH_TONE = { ok: "text-ok", warn: "text-warning", muted: "text-muted" } as const;

/** Observed Docker and model runtime for the selected environment only. */
const Runtime = ({ report, token }: { report: EnvironmentInspectReport; token: string }) => {
  const runtime = useQuery({
    queryKey: ["runtime", report.name, token],
    queryFn: () =>
      request<EnvironmentRuntimeReport>(
        `v1/environments/${encodeURIComponent(report.name)}/runtime`,
        { token },
      ),
    retry: false,
  });
  const rows = runtime.data ? runtimeRows(runtime.data) : [];

  return (
    <>
      <div className="mt-[18px] mb-2 text-[13px] font-semibold">Runtime</div>
      <Card className="overflow-x-auto">
        {runtime.error ? (
          <p role="alert" className="m-0 px-3.5 py-3 text-xs text-danger">
            {runtime.error.message}
          </p>
        ) : runtime.isPending ? (
          <p className="m-0 px-3.5 py-3 text-xs text-muted">Loading</p>
        ) : rows.length === 0 ? (
          <p className="m-0 px-3.5 py-3 text-xs text-muted">none</p>
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className={th}>Product</th>
                <th className={th}>Executor</th>
                <th className={th}>Health</th>
                <th className={th}>Units</th>
                <th className={th}>Init</th>
                <th className={th}>Model</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.product} className="[&:last-child>td]:border-b-0">
                  <td className={td}>{row.product}</td>
                  <td className={td}>{row.executor}</td>
                  <td className={`${td} ${HEALTH_TONE[row.healthTone]}`}>{row.health}</td>
                  <td className={`${td} font-mono ${row.units === "none" ? "text-muted" : ""}`}>
                    {row.units}
                  </td>
                  <td className={`${td} ${row.init === "none" ? "text-muted" : ""}`}>{row.init}</td>
                  <td className={`${td} font-mono ${row.model === "none" ? "text-muted" : ""}`}>
                    {row.model}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
};

const SubscriptionHold = ({
  report,
  product,
  channel,
  hold,
  failed,
  error,
  token,
}: {
  report: EnvironmentInspectReport;
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

/** Refetch `queryKey` once `at` passes, when the shown data goes stale. */
function useRefreshAt(at: number | undefined, queryKey: readonly unknown[]): void {
  const client = useQueryClient();
  const key = JSON.stringify(queryKey);
  useEffect(() => {
    if (at === undefined) {
      return undefined;
    }
    const timer = setTimeout(
      () => void client.invalidateQueries({ queryKey: JSON.parse(key) as unknown[] }),
      Math.max(0, at - Date.now()) + 1_000,
    );
    return () => clearTimeout(timer);
  }, [at, key, client]);
}
