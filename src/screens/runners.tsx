import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiRoot, request } from "../api/http";
import type {
  EnvironmentListEntry,
  RuntimeCredentialRevoked,
  RuntimeEnrollmentIssued,
  RuntimeEnrollmentRequest,
  RuntimeRevokeRequest,
  RuntimeRunnerList,
} from "../api/tenkai.gen";
import { isRefused, useSession } from "../auth/session";
import {
  filterEnvironments,
  runnerRows,
  runtimeEnvironment,
  shortId,
  type RunnerRow,
} from "../delivery/runners";
import {
  failure,
  newRequestId,
  refusesCredential,
  useManagementCall,
  type Outcome,
} from "../management/use-management";
import { Button, Card, ConfirmButton, Notice } from "../ui/kit";

const th = "border-b border-line px-3.5 py-2 text-left font-medium whitespace-nowrap text-muted";
const td = "border-b border-line px-3.5 py-2 align-top whitespace-nowrap";
const field =
  "min-w-0 rounded-md border border-field bg-white/4 px-2.5 py-1.5 text-xs text-fg placeholder:text-muted";

const STATE_TONE: Record<string, string> = {
  active: "text-ok",
  revoked: "text-danger",
  static: "text-muted",
};

/** How often the runner list refreshes and its ages advance. */
const AGE_TICK_MS = 15_000;

/**
 * The 2026-10-28 pick A (#34): one runner fleet table across environments
 * with an environment filter, enrollment in an inline panel, and revoke with
 * a reason and a confirmation. The registry is management-only, so a
 * credential the server refuses sees the refusal and no controls.
 */
export const Runners = () => {
  const token = useSession((state) => state.session?.accessToken);
  const refuse = useSession((state) => state.refuse);
  const managed = useSession((state) => !isRefused(state.refused, "fleet", "management"));
  const [environment, setEnvironment] = useState("");
  const [enrolling, setEnrolling] = useState(false);
  // Ages count against a ticking clock, so a silent runner shows its heartbeat growing
  // even when a refresh fails.
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), AGE_TICK_MS);
    return () => clearInterval(tick);
  }, []);
  const runners = useQuery({
    queryKey: ["runners", token],
    queryFn: () => request<RuntimeRunnerList>("v1/runners", { token }),
    enabled: token !== undefined,
    retry: false,
    refetchInterval: AGE_TICK_MS,
  });
  // Same key and request as the delivery list, so the cache is shared.
  const environments = useQuery({
    queryKey: ["environments", token],
    queryFn: () => request<EnvironmentListEntry[]>("v1/environments", { token }),
    enabled: token !== undefined,
    retry: false,
  });
  const listRefused = refusesCredential(runners.error);
  useEffect(() => {
    if (listRefused && token) {
      refuse(token, "fleet", "management");
    }
  }, [listRefused, token, refuse]);

  const list = runners.data?.runners ?? [];
  const names = filterEnvironments(
    list,
    (environments.data ?? []).map((entry) => entry.name),
  );
  const rows = runnerRows(list, environment, now);
  const controls = managed && !listRefused && token !== undefined;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="m-0 text-lg font-semibold">Runners</h1>
        <span className="text-xs text-muted">
          {runners.error
            ? runners.error.message
            : runners.isPending
              ? "Loading"
              : `${rows.length} of ${list.length}`}
        </span>
        <select
          aria-label="Environment"
          value={environment}
          onChange={(event) => setEnvironment(event.target.value)}
          className={`${field} ml-auto`}
        >
          <option value="">All environments</option>
          {names.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <Button variant="ghost" onClick={() => void runners.refetch()}>
          Refresh
        </Button>
        {controls && !enrolling && (
          <Button variant="primary" onClick={() => setEnrolling(true)}>
            Enroll runner
          </Button>
        )}
      </div>
      {controls && enrolling && (
        <Enroll
          token={token}
          environments={names}
          preferred={environment}
          onClose={() => setEnrolling(false)}
        />
      )}
      <Card className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className={th}>Runner</th>
              <th className={th}>Environment</th>
              <th className={th}>State</th>
              <th className={th}>Last pull</th>
              <th className={th}>Heartbeat</th>
              <th className={th}>Version</th>
              <th className={th}>Lease</th>
              {controls && <th className={th} aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="[&:last-child>td]:border-b-0">
                <td className={`${td} font-mono`} title={row.id}>
                  {shortId(row.id)}
                </td>
                <td className={td}>{row.environment}</td>
                <td className={`${td} ${STATE_TONE[row.state] ?? "text-warning"}`}>{row.state}</td>
                <td className={`${td} ${row.lastPull === "none" ? "text-muted" : ""}`}>
                  {row.lastPull}
                </td>
                <td className={`${td} ${row.heartbeat === "none" ? "text-muted" : ""}`}>
                  {row.heartbeat}
                </td>
                <td className={`${td} font-mono ${row.version === "none" ? "text-muted" : ""}`}>
                  {row.version}
                </td>
                <td className={`${td} ${row.lease === "none" ? "text-muted" : ""}`}>{row.lease}</td>
                {controls && (
                  <td className={td}>{row.revocable && <Revoke row={row} token={token} />}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
};

/** The server URL a runtime host reaches this API at, without a trailing slash. */
const serverUrl = () => apiRoot.href.replace(/\/$/, "");

/**
 * Issue a single-use enrollment token and show it once. The token lives in
 * this panel's state only (no query or mutation cache, no storage) and is
 * dropped by "Done, clear token" or by closing the panel.
 */
export const Enroll = ({
  token,
  environments,
  preferred,
  onClose,
}: {
  token: string;
  environments: string[];
  preferred: string;
  onClose: () => void;
}) => {
  const refuse = useSession((state) => state.refuse);
  const [picked, setEnvironment] = useState(preferred);
  // The environment list may arrive after the panel opens.
  const environment = environments.includes(picked) ? picked : (environments[0] ?? "");
  const [issued, setIssued] = useState<RuntimeEnrollmentIssued | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const scope = `environment:${environment}` as const;
  const allowed = useSession((state) => !isRefused(state.refused, scope, "management"));

  const issue = async () => {
    setPending(true);
    setOutcome(null);
    try {
      setIssued(
        await request<RuntimeEnrollmentIssued>(
          `v1/environments/${encodeURIComponent(environment)}/runtime-enrollments`,
          {
            token,
            method: "POST",
            body: {} satisfies RuntimeEnrollmentRequest,
            requestId: newRequestId(),
          },
        ),
      );
    } catch (error) {
      if (refusesCredential(error)) {
        refuse(token, scope, "management");
      }
      setOutcome(failure(error, "management"));
    } finally {
      setPending(false);
    }
  };
  const clear = () => {
    setIssued(null);
    setCopied(false);
    onClose();
  };

  if (issued) {
    const variables = runtimeEnvironment(issued, serverUrl());
    return (
      <Card className="mb-3 px-3.5 py-3 text-xs">
        <p className="m-0 mb-2">
          Single-use token for <span className="font-semibold">{issued.environment}</span>, valid
          until {new Date(issued.expires_at).toISOString()}. It is shown only now.
        </p>
        <pre
          aria-label="Runtime environment"
          className="m-0 mb-2 overflow-x-auto rounded-md border border-field bg-page px-2.5 py-2 font-mono text-[11px] select-all"
        >
          {variables}
        </pre>
        <div className="flex items-center gap-2">
          {/* The clipboard API exists only in secure contexts; over plain HTTP the block stays selectable. */}
          {window.isSecureContext && navigator.clipboard ? (
            <Button
              onClick={() =>
                void navigator.clipboard.writeText(variables).then(
                  () => setCopied(true),
                  () => setCopied(false),
                )
              }
            >
              Copy
            </Button>
          ) : (
            <span className="text-muted">Select the block above to copy it.</span>
          )}
          <Button variant="primary" onClick={clear}>
            Done, clear token
          </Button>
          {copied && <Notice tone="ok">Copied</Notice>}
        </div>
      </Card>
    );
  }
  return (
    <Card className="mb-3 px-3.5 py-3 text-xs">
      <p className="m-0 mb-2 text-muted">
        The token works once, for 15 minutes. The first enrollment of an environment makes it
        runtime-managed for good: from then on only its runtime runs its plans.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Environment to enroll"
          value={environment}
          onChange={(event) => setEnvironment(event.target.value)}
          className={field}
        >
          {environments.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        {allowed && (
          <ConfirmButton
            label="Issue token"
            confirm={`Issue a token for ${environment}`}
            disabled={!environment || pending}
            onConfirm={() => void issue()}
          />
        )}
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      {outcome && (
        <div className="mt-2">
          <Notice tone={outcome.tone}>{outcome.text}</Notice>
        </div>
      )}
    </Card>
  );
};

/** Revoke one enrolled runner: a reason, then a confirmation naming it. */
const Revoke = ({ row, token }: { row: RunnerRow; token: string }) => {
  const revoke = useManagementCall(
    token,
    `environment:${row.environment}`,
    "management",
    (result: RuntimeCredentialRevoked) => `revoked at ${new Date(result.revoked_at).toISOString()}`,
  );
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!revoke.allowed) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {open ? (
        <>
          <input
            aria-label={`Revoke reason for ${shortId(row.id)}`}
            placeholder="Reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className={field}
          />
          <ConfirmButton
            label="Revoke"
            confirm={`Revoke ${shortId(row.id)} of ${row.environment}`}
            disabled={!reason.trim() || revoke.isPending}
            onConfirm={() =>
              revoke.mutate({
                path: `v1/runners/${encodeURIComponent(row.id)}/revoke`,
                body: { reason: reason.trim() } satisfies RuntimeRevokeRequest,
              })
            }
          />
        </>
      ) : (
        <Button variant="ghost" onClick={() => setOpen(true)}>
          Revoke
        </Button>
      )}
      {revoke.outcome && <Notice tone={revoke.outcome.tone}>{revoke.outcome.text}</Notice>}
    </div>
  );
};
