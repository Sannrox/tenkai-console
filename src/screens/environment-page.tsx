import {
  Link,
  Navigate,
  useNavigate,
  useParams,
  useRouterState,
  useSearch,
} from "@tanstack/react-router";
import { lazy, Suspense, useState } from "react";
import type {
  EnvironmentInspectReport,
  ManagementLifecycleResult,
  RetireEnvironmentRequest,
} from "../api/tenkai.gen";
import { useSession } from "../auth/session";
import { channelMatrix } from "../delivery/configuration";
import { heldProducts } from "../delivery/dependencies";
import { healthRollup, instanceName, withHealth } from "../delivery/instances";
import { previousRelease, rollbackSummary } from "../delivery/rollback";
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
import { ActionsMenu, Button, Card, ConfirmButton, Notice, ObjectPage, tabClass } from "../ui/kit";
import { ConfigSections } from "./environment-config";
import {
  ActionPanel,
  Attention,
  InstanceTable,
  LinkedColumn,
  RollbackDialog,
  useMinuteClock,
  useRefreshAt,
} from "./environment-object";
import { Runtime } from "./environment-runtime";
import { EnvironmentStopStart } from "./environment-stop";

const EnvironmentDelivery = lazy(() => import("./environment-delivery"));
const EnvironmentDependencies = lazy(() => import("./environment-dependencies"));
const EnvironmentHistory = lazy(() => import("./environment-history"));
const EnvironmentSecrets = lazy(() => import("./environment-secrets"));
const InstanceExplain = lazy(() => import("./instance-explain"));
const RecalledUpgrade = lazy(() => import("./environment-recalled-upgrade"));
const EnvironmentAdopt = lazy(() => import("./environment-adopt"));
const EnvironmentIdentity = lazy(() => import("./environment-identity"));
const EnvironmentIssuer = lazy(() => import("./environment-issuer"));
const EnvironmentOverlays = lazy(() => import("./environment-overlays"));
const EnvironmentDrift = lazy(() => import("./environment-drift"));
const EnvironmentOwner = lazy(() => import("./environment-owner"));

const field =
  "min-w-0 flex-1 rounded-md border border-field bg-white/4 px-2.5 py-1.5 text-xs text-fg placeholder:text-muted";
const message = (result: ManagementLifecycleResult) => result.message;

export const ENV_TABS = [
  { id: "overview", label: "Overview" },
  { id: "instances", label: "Instances" },
  { id: "history", label: "History" },
  { id: "settings", label: "Settings" },
  { id: "security", label: "Security" },
  { id: "linked", label: "Linked" },
] as const;

export type EnvTab = (typeof ENV_TABS)[number]["id"];

const TAB_IDS = new Set<string>(ENV_TABS.map((tab) => tab.id));

/** Tab from `/environments/$environment` or `/environments/$environment/$tab`. */
export const tabFromPath = (pathname: string): EnvTab => {
  const parts = pathname.split("/").filter(Boolean);
  const last = parts[parts.length - 1] ?? "";
  if (parts.length >= 3 && TAB_IDS.has(last) && last !== "overview") {
    return last as EnvTab;
  }
  return "overview";
};

/**
 * Environment object page: one tab per URL, existing sections mounted in
 * the Issue 1 layout. Deep links `?instance=` open History.
 */
export const EnvironmentPage = () => {
  const { environment } = useParams({ strict: false }) as { environment: string };
  const { instance } = useSearch({ strict: false }) as { instance?: string };
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const tab = tabFromPath(pathname);
  if (instance !== undefined && tab !== "history") {
    return (
      <Navigate
        to="/environments/$environment/history"
        params={{ environment }}
        search={{ instance }}
        replace
      />
    );
  }
  return (
    <EnvironmentObject
      environment={environment}
      tab={tab}
      {...(instance === undefined ? {} : { instance })}
    />
  );
};

const EnvironmentObject = ({
  environment,
  tab,
  instance,
}: {
  environment: string;
  tab: EnvTab;
  instance?: string;
}) => {
  const token = useSession((state) => state.session?.accessToken);
  const navigate = useNavigate();
  const inspect = useEnvironmentInspect(token, environment);
  const report = inspect.data;
  const delivery = useDelivery(token);
  const known = channelMatrix(delivery.channels);
  const selectInstance = (value: string | undefined) => {
    void navigate({
      to: "/environments/$environment/history",
      params: { environment },
      search: value === undefined ? {} : { instance: value },
      replace: true,
    });
  };

  if (inspect.error) {
    return (
      <ObjectPage kind="Environment" name={environment}>
        <Notice tone="bad">
          {inspect.error instanceof Error ? inspect.error.message : String(inspect.error)}
        </Notice>
      </ObjectPage>
    );
  }
  if (inspect.isLoading || !report || token === undefined) {
    return (
      <ObjectPage kind="Environment" name={environment}>
        <p className="m-0 text-xs text-muted">Loading</p>
      </ObjectPage>
    );
  }

  return (
    <LoadedPage
      key={report.name}
      report={report}
      token={token}
      tab={tab}
      known={{ products: known.products, channels: known.channels }}
      {...(instance === undefined ? {} : { instance })}
      onInstance={selectInstance}
    />
  );
};

const LoadedPage = ({
  report,
  token,
  tab,
  known,
  instance: historyInstance,
  onInstance,
}: {
  report: EnvironmentInspectReport;
  token: string;
  tab: EnvTab;
  known: { products: string[]; channels: string[] };
  instance?: string;
  onInstance: (instance: string | undefined) => void;
}) => {
  const scope = `environment:${report.name}` as const;
  const path = `v1/environments/${encodeURIComponent(report.name)}`;
  const generation = expectedGeneration(report.lease);
  const now = useMinuteClock();
  const retire = useManagementCall(token, scope, "management", message);
  const rollback = useManagementCall(token, scope, "management", message);
  const subscribe = useManagementCall(token, scope, "management", message);
  const hold = useManagementCall(token, scope, "management", message);
  const [action, setAction] = useState<"hold" | "rollback" | "retire" | undefined>();
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
  const unmanaged =
    status.data?.kind === "ok"
      ? status.data.value.flatMap((row) => (row.unmanaged === undefined ? [] : [row.unmanaged]))
      : [];
  const unmanagedNames = new Set(unmanaged.map((workload) => workload.name));
  const instances = withHealth(
    report.subscriptions.filter((subscription) => !unmanagedNames.has(instanceName(subscription))),
    status.data?.kind === "ok" ? status.data.value : undefined,
    report.latest_plan,
  );
  const rollup = healthRollup(instances.map((item) => item.health));
  const showAdopt =
    unmanaged.length > 0 ||
    Boolean(report.latest_plan?.steps?.some((step) => step.action === "adopt"));
  const pendingApproval =
    report.latest_plan?.approval?.source === "required" || report.latest_plan?.state === "blocked";
  const instanceNames = [
    ...new Set(report.subscriptions.map((subscription) => instanceName(subscription))),
  ];

  const instanceTable = (
    <InstanceTable
      report={report}
      token={token}
      instances={instances}
      statusOk={status.data?.kind === "ok"}
      nowSecs={nowSecs}
      waiting={waiting}
      explain={explain}
      onExplain={setExplain}
    />
  );

  const subscribeRow =
    subscribe.allowed && tab === "instances" ? (
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
    ) : null;

  const actionItems = [
    ...(hold.allowed
      ? [
          {
            label: report.delivery_hold ? "Release hold" : "Hold delivery",
            onClick: () => setAction("hold"),
          },
        ]
      : []),
    ...(rollback.allowed && deployed.length > 0
      ? [{ label: "Roll back", onClick: () => setAction("rollback") }]
      : []),
    ...(retire.allowed ? [{ label: "Retire", onClick: () => setAction("retire") }] : []),
  ];

  return (
    <ObjectPage
      kind="Environment"
      name={report.name}
      status={rollup.label}
      primary={
        <Link
          to="/environments/$environment/plan"
          params={{ environment: report.name }}
          className="inline-flex items-center rounded-md border border-field px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap text-fg no-underline"
        >
          Open plan
        </Link>
      }
      actions={actionItems.length > 0 ? <ActionsMenu items={actionItems} /> : undefined}
      properties={[
        { label: "Description", value: report.description || "none" },
        {
          label: "Lease",
          value: report.lease.held ? `held, generation ${report.lease.generation ?? 0}` : "free",
        },
        { label: "Instances", value: String(instances.length) },
      ]}
      tabs={
        <nav
          aria-label="Environment"
          className="mb-4 flex w-full min-w-0 gap-4 overflow-x-auto text-[13px] font-medium"
        >
          {ENV_TABS.map((item) => {
            const current = tab === item.id;
            const to =
              item.id === "overview"
                ? "/environments/$environment"
                : (`/environments/$environment/${item.id}` as const);
            return (
              <Link
                key={item.id}
                to={to}
                params={{ environment: report.name }}
                search={
                  item.id === "history" && historyInstance ? { instance: historyInstance } : {}
                }
                aria-current={current ? "page" : undefined}
                className={`shrink-0 whitespace-nowrap ${tabClass(current)}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      }
      attention={
        tab === "overview" ? (
          <Attention
            rollup={rollup}
            pendingApproval={pendingApproval}
            hold={report.delivery_hold}
            report={report}
            holdView={holdView}
          />
        ) : undefined
      }
      main={
        <>
          {action === "hold" && hold.allowed && (
            <ActionPanel>
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
              {hold.outcome && <Notice tone={hold.outcome.tone}>{hold.outcome.text}</Notice>}
            </ActionPanel>
          )}
          {action === "rollback" && rollback.allowed && deployed.length > 0 && (
            <ActionPanel>
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
              {rollback.outcome && (
                <div className="flex flex-wrap items-center gap-2">
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
            </ActionPanel>
          )}
          {action === "retire" && retire.allowed && (
            <ActionPanel>
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
              {retire.outcome && <Notice tone={retire.outcome.tone}>{retire.outcome.text}</Notice>}
            </ActionPanel>
          )}
          {(tab === "overview" || tab === "instances") && (
            <Card className="min-w-0 overflow-x-auto">
              {instanceTable}
              {tab === "instances" && subscribeRow}
              {tab === "instances" && subscribe.outcome && (
                <div className="px-3.5 pb-3">
                  <Notice tone={subscribe.outcome.tone}>{subscribe.outcome.text}</Notice>
                </div>
              )}
              {tab === "instances" && (
                <EnvironmentStopStart report={report} token={token} instances={instances} />
              )}
            </Card>
          )}
          {tab === "instances" &&
            report.subscriptions.some((subscription) => subscription.state === "behind") && (
              <Suspense fallback={<p className="mt-3 text-xs text-muted">Loading</p>}>
                <RecalledUpgrade report={report} token={token} />
              </Suspense>
            )}
          {tab === "instances" && showAdopt && (
            <Suspense fallback={<p className="mt-3 text-xs text-muted">Loading</p>}>
              <EnvironmentAdopt report={report} token={token} unmanaged={unmanaged} />
            </Suspense>
          )}
          {explain !== undefined && (tab === "overview" || tab === "instances") && (
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
          {tab === "history" && (
            <Suspense fallback={<p className="mt-3 text-xs text-muted">Loading</p>}>
              <EnvironmentHistory
                environment={report.name}
                token={token}
                instances={instanceNames}
                {...(historyInstance === undefined ? {} : { instance: historyInstance })}
                onInstance={onInstance}
              />
              <EnvironmentDelivery environment={report.name} token={token} />
            </Suspense>
          )}
          {tab === "settings" && (
            <>
              <Suspense fallback={<p className="mt-3 text-xs text-muted">Loading</p>}>
                <EnvironmentOverlays report={report} />
                <EnvironmentDrift report={report} />
              </Suspense>
              <ConfigSections report={report} token={token} holdView={holdView.data} />
              <Runtime report={report} token={token} />
            </>
          )}
          {tab === "security" && (
            <Suspense fallback={<p className="mt-3 text-xs text-muted">Loading</p>}>
              <EnvironmentIdentity
                environment={report.name}
                instances={instanceNames}
                load={status.data}
                now={now}
              />
              <EnvironmentIssuer report={report} />
              <EnvironmentSecrets environment={report.name} token={token} />
              <EnvironmentDependencies
                environment={report.name}
                token={token}
                subscriptions={report.subscriptions}
                parts={["grants"]}
              />
            </Suspense>
          )}
          {tab === "linked" && (
            <Suspense fallback={<p className="mt-3 text-xs text-muted">Loading</p>}>
              <EnvironmentDependencies
                environment={report.name}
                token={token}
                subscriptions={report.subscriptions}
                parts={["holds", "graph", "bindings"]}
              />
              <EnvironmentOwner report={report} token={token} />
            </Suspense>
          )}
        </>
      }
      linked={tab === "overview" ? <LinkedColumn report={report} /> : undefined}
    />
  );
};
