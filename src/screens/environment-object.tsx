import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { EnvironmentInspectReport } from "../api/tenkai.gen";
import { channelHeadLabel } from "../delivery/configuration";
import { deployedLabel } from "../delivery/dependencies";
import type { StatusRow } from "../delivery/identity";
import { instanceName, withHealth } from "../delivery/instances";
import { holdLine, isHeldFailedTarget, productHasActivePlan } from "../delivery/model";
import { DOWNGRADE_NOTICE, previousRelease, rollbackConfirmed } from "../delivery/rollback";
import { useEnvironmentHold } from "../delivery/use-delivery";
import { Button } from "../ui/kit";
import { HoldRows, SubscriptionHold } from "./environment-hold";
import { HealthChecks } from "./health-checks";
import { PlanLink, ProductLink, ReleaseLink } from "./object-link";
import { releaseSpec, shortPlanId } from "./objects";

const th = "border-b border-line px-3.5 py-2 text-left font-medium whitespace-nowrap text-muted";
const td = "border-b border-line px-3.5 py-2 align-top";
const field =
  "min-w-0 flex-1 rounded-md border border-field bg-white/4 px-2.5 py-1.5 text-xs text-fg placeholder:text-muted";

const HEALTH_TONE = {
  ok: "text-ok",
  warn: "text-warning",
  bad: "text-danger",
  muted: "text-muted",
} as const;

export const ActionPanel = ({ children }: { children: ReactNode }) => (
  <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">{children}</div>
);

export const Attention = ({
  rollup,
  pendingApproval,
  hold,
  report,
  holdView,
}: {
  rollup: { label: string; tone: keyof typeof HEALTH_TONE };
  pendingApproval: boolean;
  hold: EnvironmentInspectReport["delivery_hold"];
  report: EnvironmentInspectReport;
  holdView: ReturnType<typeof useEnvironmentHold>;
}) => (
  <dl className="mb-3 grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 text-xs">
    <dt className="text-muted">health</dt>
    <dd className={`m-0 ${HEALTH_TONE[rollup.tone]}`}>{rollup.label}</dd>
    {pendingApproval && (
      <>
        <dt className="text-muted">approval</dt>
        <dd className="m-0 text-warning">pending approval</dd>
      </>
    )}
    {hold && (
      <>
        <dt className="text-muted">hold</dt>
        <dd className="m-0 text-warning">{holdLine(hold)}</dd>
      </>
    )}
    <HoldRows report={report} view={holdView} />
  </dl>
);

/** Product, running version, wanted head for the environment overview. */
export const RunningTable = ({ report }: { report: EnvironmentInspectReport }) => {
  if (report.subscriptions.length === 0) {
    return <p className="m-0 text-xs text-muted">none</p>;
  }
  return (
    <table className="w-full border-collapse text-xs">
      <thead>
        <tr>
          <th className={th}>Product</th>
          <th className={th}>Running</th>
          <th className={th}>Wanted</th>
        </tr>
      </thead>
      <tbody>
        {report.subscriptions.map((subscription) => {
          const wanted = channelHeadLabel(subscription.head);
          const behind = subscription.state !== "current" && subscription.state !== "stopped";
          return (
            <tr key={`${subscription.product}:${subscription.channel}`}>
              <td className={td}>
                <ProductLink product={subscription.product} environment={report.name} />
              </td>
              <td className={`${td} font-mono`}>
                {subscription.deployed ? (
                  <ReleaseLink
                    spec={releaseSpec(subscription.product, subscription.deployed)}
                    environment={report.name}
                  >
                    {subscription.deployed}
                  </ReleaseLink>
                ) : (
                  "none"
                )}
              </td>
              <td className={`${td} font-mono ${behind ? "text-warning" : ""}`}>
                <ReleaseLink
                  spec={releaseSpec(subscription.product, wanted)}
                  environment={report.name}
                >
                  {wanted}
                </ReleaseLink>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};

/** Latest plan as a row; the plan id opens it. */
export const PlansTable = ({ report }: { report: EnvironmentInspectReport }) => {
  const plan = report.latest_plan;
  if (!plan) {
    return <p className="m-0 text-xs text-muted">none</p>;
  }
  const pending = plan.approval?.source === "required" || plan.state === "blocked";
  return (
    <table className="w-full border-collapse text-xs">
      <thead>
        <tr>
          <th className={th}>Plan</th>
          <th className={th}>Status</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td className={`${td} font-mono`}>
            <PlanLink environment={report.name} planId={plan.id}>
              {shortPlanId(plan.id)}
            </PlanLink>
          </td>
          <td className={`${td} ${pending ? "text-warning" : ""}`}>
            {pending ? "pending approval" : plan.state}
          </td>
        </tr>
      </tbody>
    </table>
  );
};

export const LinkedColumn = ({ report }: { report: EnvironmentInspectReport }) => {
  const products = [...new Set(report.subscriptions.map((item) => item.product))];
  return (
    <div className="text-xs">
      <h2 className="mt-0 mb-2 text-[13px] font-semibold">Linked</h2>
      <ul className="m-0 list-none p-0">
        {report.latest_plan && (
          <li>
            <PlanLink environment={report.name} planId={report.latest_plan.id}>
              {report.latest_plan.id}
            </PlanLink>
          </li>
        )}
        {products.map((product) => (
          <li key={product} className="font-mono">
            <ProductLink product={product} environment={report.name} />
          </li>
        ))}
        {products.length === 0 && !report.latest_plan && <li className="text-muted">none</li>}
      </ul>
    </div>
  );
};

export const InstanceTable = ({
  report,
  token,
  instances,
  statusOk,
  nowSecs,
  waiting,
  explain,
  onExplain,
  debug,
  onDebug,
  showDebug,
}: {
  report: EnvironmentInspectReport;
  token: string;
  instances: ReturnType<typeof withHealth<StatusRow>>;
  statusOk: boolean;
  nowSecs: number;
  waiting: ReadonlySet<string>;
  explain: string | undefined;
  onExplain: (instance: string | undefined) => void;
  debug: string | undefined;
  onDebug: (instance: string | undefined) => void;
  showDebug: boolean;
}) => {
  if (report.subscriptions.length === 0) {
    return <p className="m-0 px-3.5 py-3 text-xs text-muted">none</p>;
  }
  return (
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
          const identity = statusOk
            ? identityLabel(row, nowSecs)
            : { label: "n/a", tone: "muted" as const };
          const held = waiting.has(instance) || waiting.has(subscription.product);
          const versionWarn =
            held || (subscription.state !== "current" && subscription.state !== "stopped");
          return (
            <tr key={instance} className="[&:last-child>td]:border-b-0">
              <td className={`${td} font-mono`}>{instance}</td>
              <td className={td}>
                <ProductLink product={subscription.product} environment={report.name} />
              </td>
              <td className={td}>{subscription.channel}</td>
              <td className={`${td} font-mono ${versionWarn ? "text-warning" : "text-ok"}`}>
                {subscription.deployed ? (
                  <ReleaseLink
                    spec={releaseSpec(subscription.product, subscription.deployed)}
                    environment={report.name}
                  >
                    {subscription.deployed}
                  </ReleaseLink>
                ) : (
                  deployedLabel(subscription.deployed, held)
                )}
              </td>
              <td className={`${td} font-mono whitespace-nowrap`}>
                <ReleaseLink
                  spec={releaseSpec(subscription.product, channelHeadLabel(subscription.head))}
                  environment={report.name}
                >
                  {channelHeadLabel(subscription.head)}
                </ReleaseLink>
                {versionWarn && (
                  <button
                    type="button"
                    className="ml-2 cursor-pointer font-sans font-semibold text-muted"
                    aria-label={`Why is ${instance} behind`}
                    aria-pressed={explain === instance}
                    onClick={() => onExplain(explain === instance ? undefined : instance)}
                  >
                    Why
                  </button>
                )}
                {showDebug && (
                  <button
                    type="button"
                    className="ml-2 cursor-pointer font-sans font-semibold text-muted"
                    aria-label={`Debug ${instance}`}
                    aria-pressed={debug === instance}
                    onClick={() => onDebug(debug === instance ? undefined : instance)}
                  >
                    Debug
                  </button>
                )}
              </td>
              <td className={`${td} ${HEALTH_TONE[health.tone]}`}>
                {health.label}
                <HealthChecks health={health} />
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
                  error={row?.error ?? subscription.error}
                  token={token}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};

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

/** The current time, refreshed every minute, for time-relative views. */
export function useMinuteClock(): number {
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
export function useRefreshAt(
  at: number | undefined,
  now: number,
  queryKey: readonly unknown[],
): void {
  const client = useQueryClient();
  const key = JSON.stringify(queryKey);
  const overdueTick = at !== undefined && at <= now ? now : 0;
  useEffect(() => {
    if (at === undefined) {
      return undefined;
    }
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
export function RollbackDialog({
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
