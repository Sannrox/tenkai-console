import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { request } from "../api/http";
import type { RuntimeRunner } from "../api/tenkai.gen";
import { useSession } from "../auth/session";
import { age, shortId } from "../delivery/runners";
import { Card, Notice, ObjectPage, tabClass } from "../ui/kit";
import { td, th } from "../ui/posture";
import { EnvironmentLink, LinkedList } from "./object-link";
import { OBJECT_TABS, tabAfter } from "./objects";
import { Revoke } from "./runners";

const AGE_TICK_MS = 15_000;

const STATE_TONE: Record<string, string> = {
  active: "text-ok",
  revoked: "text-danger",
  static: "text-muted",
};

/**
 * Runner object page: environment, instances, heartbeat, attestation,
 * credential, revoke. Revoke keeps the current request.
 */
export const RunnerPage = () => {
  const { runnerId } = useParams({ strict: false }) as { runnerId: string };
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const tab = tabAfter(pathname, "runners", 1);
  const token = useSession((state) => state.session?.accessToken);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), AGE_TICK_MS);
    return () => clearInterval(tick);
  }, []);
  const query = useQuery({
    queryKey: ["runner", runnerId, token],
    queryFn: () => request<RuntimeRunner>(`v1/runners/${encodeURIComponent(runnerId)}`, { token }),
    enabled: token !== undefined,
    retry: false,
    refetchInterval: AGE_TICK_MS,
  });
  const runner = query.data;
  const attestation = runner?.attestation;
  const heartbeat = age(
    runner?.instances.reduce<number | undefined>(
      (best, instance) =>
        instance.last_heartbeat_at !== undefined &&
        (best === undefined || instance.last_heartbeat_at > best)
          ? instance.last_heartbeat_at
          : best,
      undefined,
    ),
    now,
  );

  const linkedItems = runner
    ? [{ key: "env", node: <EnvironmentLink environment={runner.environment} /> }]
    : [];

  if (query.error) {
    return (
      <ObjectPage kind="Runner" name={shortId(runnerId)}>
        <Notice tone="bad">
          {query.error instanceof Error ? query.error.message : String(query.error)}
        </Notice>
      </ObjectPage>
    );
  }
  if (query.isPending || runner === undefined) {
    return (
      <ObjectPage kind="Runner" name={shortId(runnerId)}>
        <p className="m-0 text-xs text-muted">Loading</p>
      </ObjectPage>
    );
  }

  return (
    <ObjectPage
      kind="Runner"
      name={shortId(runner.id)}
      status={runner.state}
      primary={
        token !== undefined && runner.state === "active" ? (
          <Revoke
            row={{
              id: runner.id,
              environment: runner.environment,
              state: runner.state,
              lastPull: "none",
              heartbeat,
              version: "none",
              lease: "none",
              revocable: true,
            }}
            token={token}
          />
        ) : undefined
      }
      properties={[
        { label: "Environment", value: <EnvironmentLink environment={runner.environment} /> },
        { label: "Heartbeat", value: heartbeat },
        { label: "Auth", value: runner.auth ?? "none" },
        { label: "Credential", value: runner.id },
      ]}
      tabs={
        <nav
          aria-label="Runner"
          className="mb-4 flex w-full min-w-0 gap-4 overflow-x-auto text-[13px] font-medium"
        >
          {OBJECT_TABS.map((item) => {
            const current = tab === item.id;
            const to = item.id === "overview" ? "/runners/$runnerId" : "/runners/$runnerId/linked";
            return (
              <Link
                key={item.id}
                to={to}
                params={{ runnerId: runner.id }}
                aria-current={current ? "page" : undefined}
                className={`shrink-0 whitespace-nowrap ${tabClass(current)}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      }
      main={
        tab === "linked" ? (
          <LinkedList items={linkedItems} />
        ) : (
          <>
            <h2 className="mt-0 mb-2 text-[13px] font-semibold">Instances</h2>
            <Card className="mb-3 overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr>
                    <th className={th}>Instance</th>
                    <th className={th}>Heartbeat</th>
                    <th className={th}>Last pull</th>
                    <th className={th}>Version</th>
                    <th className={th}>Lease</th>
                  </tr>
                </thead>
                <tbody>
                  {runner.instances.length === 0 ? (
                    <tr>
                      <td className={`${td} text-muted`} colSpan={5}>
                        none
                      </td>
                    </tr>
                  ) : (
                    runner.instances.map((instance) => (
                      <tr key={instance.instance_id}>
                        <td className={`${td} font-mono`}>{instance.instance_id}</td>
                        <td className={td}>{age(instance.last_heartbeat_at, now)}</td>
                        <td className={td}>{age(instance.last_work_at, now)}</td>
                        <td className={`${td} font-mono`}>
                          {instance.runtime_version ?? "none"}
                          {instance.skew && instance.skew !== "current" ? ` ${instance.skew}` : ""}
                        </td>
                        <td className={td}>{instance.holds_lease ? "held" : "none"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </Card>
            <h2 className="mt-0 mb-2 text-[13px] font-semibold">Attestation</h2>
            <Card className="overflow-x-auto">
              <dl className="m-0 grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 px-3.5 py-3 text-xs">
                <dt className="text-muted">state</dt>
                <dd className={`m-0 ${STATE_TONE[runner.state] ?? "text-warning"}`}>
                  {runner.state}
                </dd>
                <dt className="text-muted">key</dt>
                <dd className="m-0 font-mono break-all">
                  {attestation?.key_fingerprint ?? "none"}
                </dd>
                <dt className="text-muted">evidence</dt>
                <dd className="m-0 font-mono break-all">
                  {attestation?.evidence_digest ?? "none"}
                </dd>
                <dt className="text-muted">refusal</dt>
                <dd className="m-0">{attestation?.last_refusal ?? "none"}</dd>
                {runner.revoke_reason && (
                  <>
                    <dt className="text-muted">revoked</dt>
                    <dd className="m-0">{runner.revoke_reason}</dd>
                  </>
                )}
              </dl>
            </Card>
          </>
        )
      }
      linked={tab === "overview" ? <LinkedList items={linkedItems} /> : undefined}
    />
  );
};
