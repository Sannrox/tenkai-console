import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { ApiError, request } from "../api/http";
import type {
  EnvironmentInspectReport,
  ManagementLifecycleResult,
  OidcClientDiscovery,
} from "../api/tenkai.gen";
import type { Session } from "../auth/session";
import { planSummary } from "../delivery/model";
import {
  applyBody,
  approveBody,
  expectedGeneration,
  parseEvidence,
  planBody,
  rollbackBody,
  signCommand,
} from "../plan/requests";
import { Button, Card } from "../ui/kit";
import { TopBar } from "./top-bar";

const STRIP = ["computed", "running", "succeeded"] as const;

/** Decision 3B: one plan per environment, its steps, state, and the one next action. */
export const PlanPage = ({
  environment,
  session,
  settings,
}: {
  environment: string;
  session: Session;
  settings: OidcClientDiscovery | null;
}) => {
  const token = session.accessToken;
  const queryClient = useQueryClient();
  const [digest, setDigest] = useState<string>();
  const [result, setResult] = useState<{ ok: boolean; text: string }>();
  const report = useQuery({
    queryKey: ["environment", environment, token],
    queryFn: () =>
      request<EnvironmentInspectReport>(`v1/environments/${encodeURIComponent(environment)}`, {
        token,
      }),
    retry: false,
  });

  const run = useMutation({
    mutationFn: (call: { path: string; body: unknown }) =>
      request<ManagementLifecycleResult>(call.path, { token, method: "POST", body: call.body }),
    onSuccess: (response) => {
      if (response.operation === "plan" && response.digest) {
        setDigest(response.digest);
      }
      setResult({ ok: true, text: response.message });
      void queryClient.invalidateQueries({ queryKey: ["environment", environment] });
      void queryClient.invalidateQueries({ queryKey: ["environments"] });
    },
    onError: (error) =>
      setResult({ ok: false, text: error instanceof ApiError ? error.message : String(error) }),
  });

  const data = report.data;
  const plan = data?.latest_plan ?? null;
  const generation = data ? expectedGeneration(data.lease) : 0;
  const env = encodeURIComponent(environment);
  const awaiting = plan?.state === "computed" || plan?.state === "blocked";
  const unhealthy =
    data?.subscriptions.filter((subscription) => subscription.state === "unhealthy") ?? [];
  const drift =
    data?.subscriptions.some((subscription) => subscription.state !== "current") ?? false;

  return (
    <div className="min-h-screen bg-surface">
      <TopBar active="Delivery" session={session} settings={settings} />
      <main className="px-6 py-5">
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
                  <dd className="m-0 font-mono break-all">
                    {digest ?? "shown after you plan here"}
                  </dd>
                  <dt className="text-muted">plan</dt>
                  <dd className="m-0 font-mono break-all">{plan?.id ?? "none"}</dd>
                </dl>
              </Card>
            </div>

            {awaiting && plan && (
              <Approval
                planId={plan.id}
                environment={environment}
                digest={digest}
                generation={generation}
                run={run.mutate}
                pending={run.isPending}
              />
            )}

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
                      <Button
                        disabled={run.isPending}
                        onClick={() =>
                          run.mutate({
                            path: `v1/environments/${env}/rollback`,
                            body: rollbackBody(environment, generation, subscription.product),
                          })
                        }
                      >
                        Roll back
                      </Button>
                    </div>
                  ))}
                </Card>
              </>
            )}

            {result && (
              <p role="status" className={`mt-4 text-xs ${result.ok ? "text-ok" : "text-danger"}`}>
                {result.text}
              </p>
            )}
          </>
        )}
      </main>
    </div>
  );
};

/** Approval hand-off: sign outside the browser, paste the envelope back. */
const Approval = ({
  planId,
  environment,
  digest,
  generation,
  run,
  pending,
}: {
  planId: string;
  environment: string;
  digest: string | undefined;
  generation: number;
  run: (call: { path: string; body: unknown }) => void;
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
        ? { path: `v1/plans/${plan}/apply`, body: applyBody(environment, generation, evidence) }
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
          disabled={pending || !envelope || !roots}
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
