import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { ApiError, request } from "../api/http";
import type {
  EffectiveApprovalPolicy,
  EnvironmentInspectReport,
  ManagementLifecycleResult,
  PlanApprovalsView,
} from "../api/tenkai.gen";
import { liveGeneration } from "../delivery/apply-cancel";
import {
  APPLY_COPY,
  type ApplyRow,
  type ApplyView,
  type PlanStepRef,
  applyPath,
  applyView,
  applyViewFromError,
  stepAttempt,
  stepCut,
  stepDetail,
  stepRestored,
  stepStale,
} from "../delivery/apply-steps";
import { overlayRefusal } from "../delivery/config-schema";
import {
  causeLine,
  causeRaw,
  causeSummary,
  detailNeedsExpand,
  detailPreview,
} from "../delivery/history";
import { planSummary } from "../delivery/model";
import { approvalCopy, shownDigest } from "../plan/approval";
import { quorumMatrix, quorumStatus } from "../plan/quorum";
import {
  applyBody,
  approveBody,
  expectedGeneration,
  parseEvidence,
  planBody,
  signCommand,
} from "../plan/requests";
import { Button, Card } from "../ui/kit";
import { ApplyCancel } from "./apply-cancel";
import { EnvironmentOverlays } from "./environment-overlays";
import { TargetChanges } from "./target-changes";

const STRIP = ["computed", "running", "succeeded"] as const;
/** Inspect refresh while an apply holds the lease or this page is sending one. */
const LIVE_REFRESH_MS = 2000;

/** Decision 3B: one plan per environment, its steps, state, and the one next action. */
export const PlanPage = ({ environment, token }: { environment: string; token: string }) => {
  const queryClient = useQueryClient();
  const [localDigest, setLocalDigest] = useState<{ planId: string; digest: string }>();
  const [result, setResult] = useState<ApplyView>();
  const sending = useIsMutating({ mutationKey: ["plan-run", environment] }) > 0;
  const report = useQuery({
    queryKey: ["environment", environment, token],
    queryFn: () =>
      request<EnvironmentInspectReport>(`v1/environments/${encodeURIComponent(environment)}`, {
        token,
      }),
    retry: false,
    refetchInterval: (query) =>
      sending || liveGeneration(query.state.data?.lease) !== undefined ? LIVE_REFRESH_MS : false,
  });
  const policy = useQuery({
    queryKey: ["approval-policy", environment, token],
    queryFn: () =>
      request<EffectiveApprovalPolicy>(
        `v1/environments/${encodeURIComponent(environment)}/approval-policy`,
        { token },
      ),
    retry: false,
  });

  const pendingPlan = report.data?.latest_plan;
  const awaitingPlan = pendingPlan?.state === "computed" || pendingPlan?.state === "blocked";
  const approvals = useQuery({
    queryKey: ["plan-approvals", pendingPlan?.id, token],
    queryFn: () =>
      request<PlanApprovalsView>(
        `v1/plans/${encodeURIComponent(pendingPlan?.id ?? "")}/approvals`,
        {
          token,
        },
      ),
    enabled: awaitingPlan && pendingPlan !== undefined,
    retry: false,
  });

  const refreshAfterRun = () => {
    void queryClient.invalidateQueries({ queryKey: ["environment", environment] });
    void queryClient.resetQueries({ queryKey: ["history"] });
    void queryClient.invalidateQueries({ queryKey: ["plan-approvals"] });
    void queryClient.invalidateQueries({ queryKey: ["environments"] });
    void queryClient.invalidateQueries({ queryKey: ["fleet"] });
  };
  const run = useMutation({
    mutationKey: ["plan-run", environment],
    mutationFn: (call: { path: string; body: unknown; planSteps?: readonly PlanStepRef[] }) =>
      request<ManagementLifecycleResult>(call.path, { token, method: "POST", body: call.body }),
    onSuccess: (response, call) => {
      if (response.operation === "plan" && response.digest && response.resource) {
        setLocalDigest({ planId: response.resource, digest: response.digest });
      }
      setResult(
        /\/apply(\?|$)/.test(call.path)
          ? applyView(true, response.message, response, call.planSteps)
          : { ok: true, text: response.message },
      );
      refreshAfterRun();
    },
    onError: (error, call) => {
      if (error instanceof ApiError && /\/apply(\?|$)/.test(call.path)) {
        setResult(applyViewFromError(error, call.planSteps));
        refreshAfterRun();
        return;
      }
      setResult({ ok: false, text: error instanceof ApiError ? error.message : String(error) });
    },
  });

  const data = report.data;
  const plan = data?.latest_plan ?? null;
  const digestShown = shownDigest(plan, localDigest);
  const approval = approvalCopy(plan, policy.data, localDigest);
  const generation = data ? expectedGeneration(data.lease) : 0;
  const env = encodeURIComponent(environment);
  const awaiting = plan?.state === "computed" || plan?.state === "blocked";
  const unhealthy =
    data?.subscriptions.filter((subscription) => subscription.state === "unhealthy") ?? [];
  const drift =
    data?.subscriptions.some((subscription) => subscription.state !== "current") ?? false;
  const refusal =
    result && !result.ok && result.rows === undefined && result.detail === undefined
      ? overlayRefusal(result.text)
      : undefined;

  return (
    <>
      <div className="mb-1 text-xs text-muted">
        <Link to="/" className="text-muted">
          Delivery
        </Link>{" "}
        / {environment} /{" "}
        <b className="font-medium text-fg">
          plan {plan ? plan.id.split(":").at(-1)?.slice(0, 8) : ""}
        </b>
      </div>
      {report.error ? (
        <p role="alert" className="text-xs text-danger">
          {report.error.message}
        </p>
      ) : !data ? (
        <p className="text-xs text-muted">Loading</p>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <h1 className="m-0 text-lg font-semibold">{plan ? planSummary(plan) : "No plan"}</h1>
            <span className="text-xs text-muted">
              {environment} · lease{" "}
              {data.lease.held ? `held, generation ${generation}` : "free, generation 0"}
            </span>
            <div className="ml-auto flex gap-2">
              {plan?.state !== "running" && (
                <Button
                  variant={drift && !awaiting ? "primary" : "plain"}
                  disabled={run.isPending}
                  onClick={() =>
                    run.mutate({
                      path: `v1/environments/${env}/plans`,
                      body: planBody(environment, generation),
                    })
                  }
                >
                  {plan ? "Plan again" : "Plan"}
                </Button>
              )}
            </div>
          </div>

          {plan && (
            <div className="mb-4 flex overflow-hidden rounded-md border border-line">
              {STRIP.map((step, index) => {
                const reached = STRIP.indexOf(plan.state as (typeof STRIP)[number]);
                const label =
                  step === "succeeded" && plan.state === "failed"
                    ? "Failed"
                    : step === "computed" && plan.state === "blocked"
                      ? "Blocked"
                      : step[0]?.toUpperCase() + step.slice(1);
                const current =
                  plan.state === step ||
                  (step === "succeeded" && plan.state === "failed") ||
                  (step === "computed" && plan.state === "blocked");
                return (
                  <div
                    key={step}
                    className={`flex-1 border-r border-line px-3 py-2 text-xs last:border-r-0 ${current ? "bg-selected text-fg" : index < reached ? "text-fg" : "text-muted"}`}
                  >
                    <b className="block font-mono text-[10px] font-medium">{index + 1}</b>
                    {label}
                  </div>
                );
              })}
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <Card>
              <h2 className="mx-3.5 mt-3 mb-0 text-[13px] font-semibold">
                Steps{" "}
                <span className="font-mono text-[11px] font-medium text-muted">
                  {plan?.step_count ?? 0}
                </span>
              </h2>
              <div className="px-3.5 py-3 font-mono text-xs leading-[1.7]">
                {plan?.steps?.length ? (
                  plan.steps.map((step) => (
                    <div key={step.id}>
                      {step.from && (
                        <span className="text-danger">
                          - {step.product} {step.from}
                        </span>
                      )}
                      {step.from && <br />}
                      <span className="text-ok">
                        + {step.product} {step.to}
                      </span>{" "}
                      <span className="text-muted">
                        {step.release_id} · {step.action}
                      </span>
                    </div>
                  ))
                ) : (
                  <span className="text-muted">
                    {plan ? "no step details returned" : "nothing planned"}
                  </span>
                )}
                {plan?.steps_truncated && <div className="text-muted">more steps not shown</div>}
              </div>
            </Card>
            <Card>
              <dl className="m-0 grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 px-3.5 py-3 text-xs">
                <dt className="text-muted">state</dt>
                <dd
                  className={`m-0 ${awaiting ? "text-warning" : plan?.state === "failed" ? "text-danger" : ""}`}
                >
                  {plan?.state ?? "none"}
                </dd>
                <dt className="text-muted">held</dt>
                <dd className="m-0">{plan?.status_detail || "nothing reported"}</dd>
                <dt className="text-muted">digest</dt>
                <dd className="m-0 font-mono break-all">{approval.digest}</dd>
                <dt className="text-muted">approved</dt>
                <dd className="m-0">{approval.source}</dd>
                <dt className="text-muted">human</dt>
                <dd className="m-0">{approval.human}</dd>
                <dt className="text-muted">stale</dt>
                <dd className={`m-0 ${approval.stale !== "no" ? "text-warning" : ""}`}>
                  {approval.stale}
                </dd>
                <dt className="text-muted">plan</dt>
                <dd className="m-0 font-mono break-all">{plan?.id ?? "none"}</dd>
              </dl>
            </Card>
          </div>

          {plan && <TargetChanges plan={plan} token={token} />}

          {awaiting && plan && (
            <Quorum
              view={approvals.data}
              error={approvals.error?.message}
              stale={approvals.error !== null && approvals.data !== undefined}
            />
          )}

          {awaiting && plan && (
            <Approval
              applyBlocked={
                approvals.data ? quorumStatus(quorumMatrix(approvals.data)).applyBlocked : false
              }
              planId={plan.id}
              planSteps={plan.steps}
              environment={environment}
              digest={digestShown}
              generation={generation}
              run={run.mutate}
              pending={run.isPending}
            />
          )}

          <ApplyCancel report={data} token={token} />

          {unhealthy.length > 0 && (
            <>
              <h2 className="mt-[18px] mb-2 text-[13px] font-semibold">Recover</h2>
              <Card>
                {unhealthy.map((subscription) => (
                  <div
                    key={subscription.product}
                    className="flex items-center gap-3 border-t border-line px-3.5 py-2.5 first:border-t-0"
                  >
                    <span className="size-[7px] rounded-full bg-danger" />
                    <div className="flex-1 text-xs">
                      <b className="font-semibold">{subscription.product}</b>{" "}
                      <span className="text-muted">
                        {subscription.deployed} unhealthy
                        {subscription.error ? `: ${subscription.error}` : ""}
                      </span>
                    </div>
                    <Link
                      to="/environments"
                      search={{ environment }}
                      className="text-xs font-medium text-muted"
                    >
                      Open environment
                    </Link>
                  </div>
                ))}
              </Card>
            </>
          )}

          <EnvironmentOverlays report={data} {...(refusal === undefined ? {} : { refusal })} />

          {result && refusal === undefined && (
            <>
              <p role="status" className={`mt-4 text-xs ${result.ok ? "text-ok" : "text-danger"}`}>
                {result.text}
              </p>
              {result.detail === "unavailable" && (
                <p className="mt-1 text-xs text-muted">{APPLY_COPY.unavailable}</p>
              )}
              {result.rows && <ApplySteps environment={environment} rows={result.rows} />}
            </>
          )}
        </>
      )}
    </>
  );
};

/** Approval hand-off: sign outside the browser, paste the envelope back. */
const Approval = ({
  applyBlocked,
  planId,
  planSteps,
  environment,
  digest,
  generation,
  run,
  pending,
}: {
  /** The server reports more approvals missing than one paste can add. */
  applyBlocked: boolean;
  planId: string;
  planSteps: readonly PlanStepRef[] | undefined;
  environment: string;
  digest: string | undefined;
  generation: number;
  run: (call: { path: string; body: unknown; planSteps?: readonly PlanStepRef[] }) => void;
  pending: boolean;
}) => {
  const [envelope, setEnvelope] = useState("");
  const [roots, setRoots] = useState("");
  const [problem, setProblem] = useState<string>();
  const command = signCommand(environment, digest);
  const submit = (operation: "approve" | "apply") => {
    const evidence = parseEvidence(environment, envelope, roots);
    if (typeof evidence === "string") {
      setProblem(evidence);
      return;
    }
    setProblem(undefined);
    const plan = encodeURIComponent(planId);
    run(
      operation === "apply"
        ? {
            path: applyPath(planId),
            body: applyBody(environment, generation, evidence),
            ...(planSteps === undefined ? {} : { planSteps }),
          }
        : {
            path: `v1/plans/${plan}/approve`,
            body: approveBody(environment, generation, evidence),
          },
    );
  };
  const field =
    "w-full rounded-md border border-field bg-white/4 px-2.5 py-1.5 font-mono text-xs text-fg placeholder:text-muted";
  return (
    <>
      <h2 className="mt-[18px] mb-2 text-[13px] font-semibold">Approval</h2>
      <div className="flex items-center gap-2.5 rounded-md border border-dashed border-field px-3 py-2 text-xs">
        <span className="font-mono break-all">{command}</span>
        <Button className="ml-auto" onClick={() => void navigator.clipboard.writeText(command)}>
          Copy
        </Button>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <textarea
          rows={5}
          aria-label="Approval envelope"
          placeholder="Paste approval.json"
          value={envelope}
          onChange={(event) => setEnvelope(event.target.value)}
          className={field}
        />
        <textarea
          rows={5}
          aria-label="Approval trust roots"
          placeholder="Paste approval-trust.toml"
          value={roots}
          onChange={(event) => setRoots(event.target.value)}
          className={field}
        />
      </div>
      <div className="mt-2 flex gap-2">
        <Button
          variant="primary"
          disabled={pending || !envelope || !roots || applyBlocked}
          onClick={() => submit("apply")}
        >
          Apply
        </Button>
        <Button disabled={pending || !envelope || !roots} onClick={() => submit("approve")}>
          Approve only
        </Button>
      </div>
      {problem && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {problem}
        </p>
      )}
    </>
  );
};

const th = "border-b border-line px-3 py-1.5 text-left font-medium whitespace-nowrap text-muted";
const td = "border-b border-line px-3 py-1.5 whitespace-nowrap";

const STEP_TONE: Record<string, string> = {
  succeeded: "text-ok",
  failed: "text-danger",
  rolled_back: "text-warning",
  blocked: "text-warning",
  "not run": "text-muted",
};

const ApplySteps = ({ environment, rows }: { environment: string; rows: ApplyRow[] }) => (
  <Card className="mt-3 max-w-full min-w-0 overflow-x-auto">
    <table aria-label="Apply steps" className="w-full border-collapse text-xs">
      <thead>
        <tr>
          <th className={th}>Product</th>
          <th className={th}>Instance</th>
          <th className={th}>Action</th>
          <th className={th}>Status</th>
          <th className={th}>To</th>
          <th className={th}>Restored</th>
          <th className={th}>Cause</th>
          <th className={th}>History</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const restored = stepRestored(row);
          const attempt = stepAttempt(row);
          return (
            <tr
              key={`${row.product}:${row.instance}:${row.action}:${row.to_version}:${row.status}:${attempt}`}
              className="[&:last-child>td]:border-b-0"
            >
              <td className={`${td} font-mono`}>{row.product}</td>
              <td className={`${td} font-mono`}>{row.instance}</td>
              <td className={td}>{row.action}</td>
              <td className={`${td} ${STEP_TONE[row.status] ?? ""}`}>{row.status}</td>
              <td className={`${td} font-mono`}>{row.to_version}</td>
              <td className={`${td} font-mono ${restored === APPLY_COPY.none ? "text-muted" : ""}`}>
                {restored}
              </td>
              <td className={`${td} whitespace-normal`}>
                <StepCause row={row} />
              </td>
              <td className={`${td} font-mono ${attempt === APPLY_COPY.none ? "text-muted" : ""}`}>
                {attempt === APPLY_COPY.none ? (
                  attempt
                ) : (
                  <Link
                    to="/environments"
                    search={{ environment, instance: row.instance }}
                    className="font-medium text-muted"
                  >
                    {attempt}
                  </Link>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </Card>
);

const StepCause = ({ row }: { row: ApplyRow }) => {
  const cut = stepCut(row) ? <span className="text-muted"> {APPLY_COPY.cut}</span> : null;
  const stale = stepStale(row);
  if (stale !== undefined) {
    return <span className="text-warning">{stale}</span>;
  }
  if (row.cause !== undefined) {
    const preview = `${causeLine(row.cause)}: ${causeSummary(row.cause)}`;
    const raw = causeRaw(row.cause);
    if (raw === "") {
      return (
        <>
          {preview}
          {cut}
        </>
      );
    }
    return (
      <details>
        <summary className="cursor-pointer">
          {preview}
          {cut}
        </summary>
        <div className="mt-1 whitespace-pre-wrap">{raw}</div>
      </details>
    );
  }
  const detail = stepDetail(row);
  if (detail === "") {
    return cut ?? <span className="text-muted">{APPLY_COPY.none}</span>;
  }
  if (!detailNeedsExpand(detail)) {
    return (
      <>
        {detail}
        {cut}
      </>
    );
  }
  return (
    <details>
      <summary className="cursor-pointer">
        {detailPreview(detail)}
        {cut}
      </summary>
      <div className="mt-1 whitespace-pre-wrap">{detail}</div>
    </details>
  );
};

/**
 * Pick B (#38): approvers by policy group, each cell signed (when), pending
 * or n/a, and how far the plan is from its quorum.
 */
const Quorum = ({
  view,
  error,
  stale,
}: {
  view: PlanApprovalsView | undefined;
  error: string | undefined;
  stale: boolean;
}) => {
  if (!view) {
    return (
      <p aria-label="Approvals" className="mt-[18px] text-xs text-muted">
        Approvals: {error ?? "Loading"}
      </p>
    );
  }
  const matrix = quorumMatrix(view);
  const status = quorumStatus(matrix);
  return (
    <>
      <h2 className="mt-[18px] mb-2 text-[13px] font-semibold">
        Approvals <span className="font-normal text-muted">{view.purpose}</span>
      </h2>
      {stale && (
        <p role="alert" className="m-0 mb-2 text-xs text-danger">
          Refresh failed: {error}. Showing the last approvals.
        </p>
      )}
      <Card className="overflow-x-auto">
        <table aria-label="Approvals by group" className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className={th}>Signer</th>
              {matrix.groups.map((group, column) => (
                <th key={group} className={th}>
                  {group} {matrix.perGroup[column]}
                </th>
              ))}
              <th className={th}>Valid until</th>
            </tr>
          </thead>
          <tbody>
            {matrix.rows.length === 0 ? (
              <tr>
                <td className={`${td} border-b-0 text-muted`} colSpan={matrix.groups.length + 2}>
                  {view.eligible ? "No eligible approvers" : "No approvals collected"}
                </td>
              </tr>
            ) : (
              matrix.rows.map((row) => (
                <tr key={row.keyId} className="[&:last-child>td]:border-b-0">
                  <td className={td} title={row.keyId}>
                    {row.signer}
                  </td>
                  {row.cells.map((cell, column) => (
                    <td
                      key={matrix.groups[column]}
                      className={`${td} ${typeof cell === "object" ? "text-ok" : cell === "pending" ? "text-warning" : "text-muted"}`}
                    >
                      {typeof cell === "object"
                        ? cell.signedAt === undefined
                          ? "signed"
                          : new Date(cell.signedAt).toISOString()
                        : cell}
                    </td>
                  ))}
                  <td className={`${td} text-muted`}>
                    {row.expiresAt === undefined ? "" : new Date(row.expiresAt).toISOString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
      <p
        aria-label="Quorum"
        className={`mt-2 mb-0 text-xs ${view.missing === 0 ? "text-ok" : "text-warning"}`}
      >
        {status.line}
        {view.exclude_requester ? " The apply requester's own approval does not count." : ""}
      </p>
    </>
  );
};
