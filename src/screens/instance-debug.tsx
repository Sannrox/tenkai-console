import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { request } from "../api/http";
import type { EffectiveApprovalPolicy } from "../api/tenkai.gen";
import {
  type DebugElevation,
  type DebugSession,
  countedApprovals,
  debugPolicy,
  elevationNeed,
  elevationsPath,
  fetchElevations,
  fetchSessions,
  instanceHistory,
  liveElevation,
  liveSession,
  parseElevationApproval,
  remainingLabel,
  sessionPath,
} from "../delivery/debug-sessions";
import {
  STREAM_COPY,
  STREAM_PROTOCOL,
  canAttachStream,
  commandFrame,
  decodeBytes,
  parseControl,
  streamUrl,
} from "../delivery/debug-stream";
import { useManagementCall } from "../management/use-management";
import { Button, Card, ConfirmButton, Notice } from "../ui/kit";
import { useMinuteClock, useRefreshAt } from "./environment-object";

const field =
  "min-w-0 w-full rounded-md border border-field bg-white/4 px-2.5 py-1.5 font-mono text-xs text-fg placeholder:text-muted";
const dt = "text-muted";
const dd = "m-0 font-mono";

const COPY = {
  unavailable: "This server does not offer debug sessions.",
  forbidden: "No access",
  forbidEnv: "This environment forbids debug sessions.",
  loading: "Loading",
  empty: "No session. Opens read-only for up to 4h.",
  expired: "Session ended at the bound. Output is gone.",
  closed: "Session closed. Output is gone.",
} as const;

const th = "border-b border-line px-3.5 py-2 text-left font-medium whitespace-nowrap text-muted";
const td = "border-b border-line px-3.5 py-2 align-top";

/**
 * Time-boxed command session on one instance, as a panel under the instance
 * table. GET `/v1/debug-sessions?environment=`.
 */
export const InstanceDebug = ({
  environment,
  instance,
  token,
  onClose,
}: {
  environment: string;
  instance: string;
  token: string;
  onClose: () => void;
}) => {
  const now = useMinuteClock();
  const sessions = useQuery({
    queryKey: ["debug-sessions", environment, token],
    queryFn: () => fetchSessions(environment, token),
    retry: false,
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
  const load = sessions.data;
  const live = load?.kind === "ok" ? liveSession(load.value, instance) : undefined;
  useRefreshAt(live?.not_after, now, ["debug-sessions", environment, token]);
  const elevations = useQuery({
    queryKey: ["debug-elevations", live?.id, token],
    queryFn: () => fetchElevations(live?.id ?? "", token),
    enabled: live !== undefined,
    retry: false,
  });

  return (
    <section aria-label={`Debug ${instance}`}>
      <div className="mt-[18px] mb-2 flex items-center gap-2">
        <h2 className="m-0 text-[13px] font-semibold">
          Debug <span className="font-mono">{instance}</span>
        </h2>
        <Button variant="ghost" className="ml-auto" aria-label="Close panel" onClick={onClose}>
          Close
        </Button>
      </div>
      <Card className="min-w-0 overflow-x-auto">
        <PanelBody
          environment={environment}
          instance={instance}
          token={token}
          now={now}
          load={load}
          policy={policy.data}
          policyPending={policy.isPending}
          live={live}
          elevations={elevations.data}
        />
      </Card>
    </section>
  );
};

const PanelBody = ({
  environment,
  instance,
  token,
  now,
  load,
  policy,
  policyPending,
  live,
  elevations,
}: {
  environment: string;
  instance: string;
  token: string;
  now: number;
  load: Awaited<ReturnType<typeof fetchSessions>> | undefined;
  policy: EffectiveApprovalPolicy | undefined;
  policyPending: boolean;
  live: DebugSession | undefined;
  elevations: DebugElevation[] | undefined;
}) => {
  if (load === undefined || policyPending) {
    return <p className="m-0 px-3.5 py-3 text-xs text-muted">{COPY.loading}</p>;
  }
  if (load.kind === "unavailable") {
    return <p className="m-0 px-3.5 py-3 text-xs text-muted">{COPY.unavailable}</p>;
  }
  if (load.kind === "forbidden") {
    return <p className="m-0 px-3.5 py-3 text-xs text-muted">{COPY.forbidden}</p>;
  }
  if (load.kind === "error") {
    return (
      <p role="alert" className="m-0 px-3.5 py-3 text-xs text-danger">
        {load.message}
      </p>
    );
  }
  if (debugPolicy(policy) === "forbid") {
    return <p className="m-0 px-3.5 py-3 text-xs text-muted">{COPY.forbidEnv}</p>;
  }
  const history = instanceHistory(load.value, instance);
  const ended = live === undefined ? history.find((item) => item.state !== "open") : undefined;
  return (
    <div className="px-3.5 py-3 text-xs">
      {live ? (
        <LiveSession
          environment={environment}
          instance={instance}
          token={token}
          now={now}
          session={live}
          policy={policy}
          elevations={elevations}
        />
      ) : (
        <OpenForm environment={environment} instance={instance} token={token} ended={ended} />
      )}
      {history.length > 0 && <History rows={history} now={now} />}
    </div>
  );
};

const OpenForm = ({
  environment,
  instance,
  token,
  ended,
}: {
  environment: string;
  instance: string;
  token: string;
  ended: DebugSession | undefined;
}) => {
  const [reason, setReason] = useState("");
  const open = useManagementCall(token, `environment:${environment}`, "debug", () => "Opened");
  return (
    <>
      {ended?.state === "expired" ? (
        <p className="m-0 mb-3 text-muted">{COPY.expired}</p>
      ) : ended?.state === "closed" ? (
        <p className="m-0 mb-3 text-muted">{COPY.closed}</p>
      ) : (
        <p className="m-0 mb-3 text-muted">{COPY.empty}</p>
      )}
      <label className="mb-2 block">
        <span className="text-muted">Reason</span>
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          aria-label="Debug reason"
          className={`${field} mt-1`}
        />
      </label>
      <ConfirmButton
        label="Open session"
        confirm={`Open read-only debug on ${instance}`}
        disabled={!reason.trim() || open.isPending}
        onConfirm={() =>
          open.mutate({
            path: "v1/debug-sessions",
            body: { environment, instance, reason: reason.trim() },
          })
        }
      />
      {open.outcome && (
        <div className="mt-2">
          <Notice tone={open.outcome.tone}>{open.outcome.text}</Notice>
        </div>
      )}
    </>
  );
};

const LiveSession = ({
  environment,
  instance,
  token,
  now,
  session,
  policy,
  elevations,
}: {
  environment: string;
  instance: string;
  token: string;
  now: number;
  session: DebugSession;
  policy: EffectiveApprovalPolicy | undefined;
  elevations: DebugElevation[] | undefined;
}) => {
  const close = useManagementCall(token, `environment:${environment}`, "debug", () => "Closed");
  const elevate = useManagementCall(
    token,
    `environment:${environment}`,
    "debug",
    () => "Requested",
  );
  const approve = useManagementCall(
    token,
    `environment:${environment}`,
    "debug",
    () => "Submitted",
  );
  const revoke = useManagementCall(token, `environment:${environment}`, "debug", () => "Revoked");
  const pending = liveElevation(elevations);
  const [writeReason, setWriteReason] = useState("");
  const [envelope, setEnvelope] = useState("");
  const [pasteError, setPasteError] = useState<string>();
  const allowElevate = debugPolicy(policy) === "elevate";
  const writeActive = pending?.state === "active";
  const streamError = session.runtime?.stream_error;
  const attach = canAttachStream(token);
  const outcome = close.outcome ?? elevate.outcome ?? approve.outcome ?? revoke.outcome;

  return (
    <>
      <dl className="m-0 mb-3 grid grid-cols-[120px_1fr] gap-x-3 gap-y-1">
        <dt className={dt}>state</dt>
        <dd className={dd}>{writeActive ? "write" : "read"}</dd>
        {writeActive && pending?.not_after ? (
          <>
            <dt className={dt}>write until</dt>
            <dd className={dd}>{remainingLabel(pending.not_after, now)}</dd>
            <dt className={dt}>session</dt>
            <dd className={dd}>{remainingLabel(session.not_after, now)}</dd>
          </>
        ) : (
          <>
            <dt className={dt}>ends</dt>
            <dd className={dd}>{remainingLabel(session.not_after, now)}</dd>
          </>
        )}
        <dt className={dt}>opened</dt>
        <dd className={dd}>
          {session.subject} for {session.reason}
        </dd>
        <dt className={dt}>runtime</dt>
        <dd className={dd}>
          {streamError
            ? STREAM_COPY.refused
            : !attach
              ? STREAM_COPY.bearer
              : (session.runtime?.instance ?? STREAM_COPY.waiting)}
        </dd>
      </dl>
      <CommandLog
        session={session}
        writeActive={writeActive}
        blocked={Boolean(streamError) || !attach}
      />
      {allowElevate && pending?.state === "pending" && (
        <ElevationPaste
          elevation={pending}
          need={elevationNeed(policy)}
          envelope={envelope}
          error={pasteError}
          pending={approve.isPending}
          onEnvelope={setEnvelope}
          onSubmit={() => {
            const parsed = parseElevationApproval(environment, session.id, pending.id, envelope);
            if (typeof parsed === "string") {
              setPasteError(parsed);
              return;
            }
            setPasteError(undefined);
            approve.mutate({
              path: `${elevationsPath(session.id)}/${encodeURIComponent(pending.id)}/approvals`,
              body: { approval: parsed },
            });
          }}
        />
      )}
      {allowElevate && pending === undefined && (
        <div className="mt-3">
          <label className="mb-2 block">
            <span className="text-muted">Write reason</span>
            <input
              value={writeReason}
              onChange={(event) => setWriteReason(event.target.value)}
              aria-label="Write reason"
              className={`${field} mt-1`}
            />
          </label>
          <ConfirmButton
            label="Request write"
            confirm={`Request write on ${instance}`}
            disabled={!writeReason.trim() || elevate.isPending}
            onConfirm={() =>
              elevate.mutate({
                path: elevationsPath(session.id),
                body: { reason: writeReason.trim() },
              })
            }
          />
        </div>
      )}
      {writeActive && pending && (
        <div className="mt-3">
          <ConfirmButton
            label="Revoke write"
            confirm={`Revoke write on ${instance}`}
            disabled={revoke.isPending}
            onConfirm={() =>
              revoke.mutate({
                path: `${elevationsPath(session.id)}/${encodeURIComponent(pending.id)}/revoke`,
                body: { reason: "revoked" },
              })
            }
          />
        </div>
      )}
      <div className="mt-3">
        <ConfirmButton
          label="Close"
          confirm={`Close debug on ${instance}`}
          disabled={close.isPending}
          onConfirm={() =>
            close.mutate({
              path: `${sessionPath(session.id)}/close`,
              body: { reason: "closed" },
            })
          }
        />
      </div>
      {outcome && (
        <div className="mt-2">
          <Notice tone={outcome.tone}>{outcome.text}</Notice>
        </div>
      )}
    </>
  );
};

const ElevationPaste = ({
  elevation,
  need,
  envelope,
  error,
  pending,
  onEnvelope,
  onSubmit,
}: {
  elevation: DebugElevation;
  need: number;
  envelope: string;
  error: string | undefined;
  pending: boolean;
  onEnvelope: (value: string) => void;
  onSubmit: () => void;
}) => (
  <div className="mt-3">
    <p className="m-0 mb-2 text-muted">
      write pending · {elevation.reason} · {countedApprovals(elevation)} of {need} other approver
      {need === 1 ? "" : "s"}. Paste signed elevation approval. The requester does not count.
    </p>
    <textarea
      rows={5}
      aria-label="Elevation envelope"
      placeholder="approval.json"
      value={envelope}
      onChange={(event) => onEnvelope(event.target.value)}
      className={field}
    />
    <div className="mt-2">
      <Button variant="primary" disabled={pending || !envelope} onClick={onSubmit}>
        Submit approval
      </Button>
    </div>
    {error && (
      <p role="alert" className="mt-2 text-danger">
        {error}
      </p>
    )}
  </div>
);

const CommandLog = ({
  session,
  writeActive,
  blocked,
}: {
  session: DebugSession;
  writeActive: boolean;
  blocked: boolean;
}) => {
  const [log, setLog] = useState("");
  const [line, setLine] = useState("");
  const [attached, setAttached] = useState(false);
  const socket = useRef<WebSocket | undefined>(undefined);
  useEffect(() => {
    if (blocked) {
      return undefined;
    }
    const ws = new WebSocket(streamUrl(session.id), STREAM_PROTOCOL);
    socket.current = ws;
    const append = (chunk: string) => setLog((prev) => prev + chunk);
    ws.addEventListener("message", (event) => {
      void (async () => {
        if (typeof event.data === "string") {
          const control = parseControl(event.data);
          if (control?.type === "attached") {
            setAttached(true);
            return;
          }
          if (control?.type === "exit") {
            append(`exit ${control.code}\n`);
            return;
          }
          if (control?.type === "close") {
            append(control.message ? `${control.message}\n` : "");
            setAttached(false);
          }
          return;
        }
        if (event.data instanceof Blob || event.data instanceof ArrayBuffer) {
          append(await decodeBytes(event.data));
        }
      })();
    });
    ws.addEventListener("close", () => {
      setAttached(false);
      socket.current = undefined;
    });
    return () => {
      ws.close();
      socket.current = undefined;
    };
  }, [session.id, blocked]);
  const run = () => {
    const command = line.trim();
    if (!command || socket.current?.readyState !== WebSocket.OPEN) {
      return;
    }
    setLog((prev) => `${prev}$ ${command}\n`);
    socket.current.send(commandFrame(command));
    setLine("");
  };
  const readHint = "read commands: get, describe, logs [--tail N]";
  const writeHint = writeActive ? "restart" : undefined;
  return (
    <div className="mt-3">
      <p className="m-0 mb-1 text-muted">
        {blocked
          ? session.runtime?.stream_error
            ? STREAM_COPY.refused
            : STREAM_COPY.bearer
          : attached
            ? [readHint, writeHint].filter(Boolean).join(" · ")
            : STREAM_COPY.waiting}
      </p>
      <pre className="m-0 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-xs">
        {log || "$"}
      </pre>
      <div className="mt-2 flex gap-2">
        <input
          aria-label="Debug command"
          value={line}
          onChange={(event) => setLine(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              run();
            }
          }}
          disabled={blocked || !attached}
          className={field}
        />
        <Button disabled={blocked || !attached || !line.trim()} onClick={run}>
          Run
        </Button>
      </div>
    </div>
  );
};

const History = ({ rows, now }: { rows: DebugSession[]; now: number }) => (
  <div className="mt-4">
    <h3 className="mt-0 mb-2 text-[13px] font-semibold">History</h3>
    <table className="w-full border-collapse text-xs" aria-label="Debug history">
      <thead>
        <tr>
          <th className={th}>Who</th>
          <th className={th}>When</th>
          <th className={th}>Ended</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className="[&:last-child>td]:border-b-0">
            <td className={`${td} font-mono`}>{row.subject}</td>
            <td className={td}>{whenLabel(row.opened_at, now)}</td>
            <td className={td}>{row.state}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const whenLabel = (openedAt: number, now: number): string => {
  const start = new Date(openedAt);
  const sameDay =
    start.getUTCFullYear() === new Date(now).getUTCFullYear() &&
    start.getUTCMonth() === new Date(now).getUTCMonth() &&
    start.getUTCDate() === new Date(now).getUTCDate();
  const hours = String(start.getUTCHours()).padStart(2, "0");
  const minutes = String(start.getUTCMinutes()).padStart(2, "0");
  return sameDay ? `today ${hours}:${minutes}` : start.toISOString().slice(0, 16).replace("T", " ");
};

export default InstanceDebug;
