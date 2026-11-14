import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { ChannelListEntry, ManagementLifecycleResult } from "../api/tenkai.gen";
import { useAuthSession } from "../auth/identity";
import { graceWindow } from "../delivery/grace";
import {
  admitBody,
  admitOutcome,
  admitPath,
  admittable,
  fetchPace,
  instanceName,
  paceBody,
  paceChannels,
  paceInstant,
  paceOutcome,
  paceStatus,
  pacePath,
  paceText,
  parsePace,
  type PaceChannel,
  type PaceInstance,
  type PaceLoad,
  type PaceProgress,
} from "../delivery/pace";
import { useManagementCall } from "../management/use-management";
import { ConfirmButton, Notice } from "../ui/kit";

const field =
  "min-w-0 rounded-md border border-field bg-white/4 px-2.5 py-1.5 font-mono text-xs text-fg placeholder:text-muted";

const th = "border-b border-line py-1.5 pr-4 text-left font-medium whitespace-nowrap text-muted";
const td = "border-b border-line py-1.5 pr-4 align-top";

const STATUS_TEXT = {
  complete: "complete",
  paused: "paused by maintenance window",
  "in progress": "in progress",
} as const;

// Pacing moves on minutes, so progress is read again each minute until done.
const REFRESH_MS = 60_000;

const LOAD_TEXT = {
  unavailable: "This server does not report upgrade pace.",
  forbidden: "No access",
  error: "Could not load",
} as const;

/**
 * Upgrade pace on the Releases screen: pick a channel with a head, read the
 * pace and progress on its current head, set or turn off the pace, and admit
 * one instance early. The picked channel's declared exposure grace shows
 * too. Loaded lazily, and one read per picked channel, so a large catalog
 * costs nothing up front.
 */
const ChannelPace = ({ token, items }: { token: string; items: readonly ChannelListEntry[] }) => {
  const channels = paceChannels(items);
  const [picked, setPicked] = useState("");
  const target = channels.find((entry) => `${entry.product}/${entry.channel}` === picked);
  if (channels.length === 0) {
    return null;
  }
  return (
    <section aria-label="Upgrade pace">
      <h2 className="mt-[18px] mb-2 text-[13px] font-semibold">Upgrade pace</h2>
      <select
        aria-label="Channel"
        value={picked}
        onChange={(event) => setPicked(event.target.value)}
        className={field}
      >
        <option value="">Channel</option>
        {channels.map(({ product, channel }) => (
          <option key={`${product}/${channel}`} value={`${product}/${channel}`}>
            {product}/{channel}
          </option>
        ))}
      </select>
      {target && (
        <p aria-label="Channel grace" className="mt-2 mb-0 text-xs">
          <span className="text-muted">exposure grace </span>
          <span className="font-mono">
            {graceWindow(
              items.find((item) => item.product === target.product && item.name === target.channel)
                ?.exposure_grace_ms,
            )}
          </span>
        </p>
      )}
      {target && <Pace key={picked} token={token} target={target} />}
    </section>
  );
};

/**
 * One channel's pace and its progress. The editor and early admission are
 * offered only when `/v1/auth/me` grants management and no credential refusal
 * hid it. Each confirmed click is one request; a lost answer reads as unknown
 * and is never resent. A confirmed write reads the pace again.
 */
const Pace = ({ token, target }: { token: string; target: PaceChannel }) => {
  const { product, channel } = target;
  const query = useQuery({
    queryKey: ["channel-pace", token, product, channel],
    queryFn: () => fetchPace(target, token),
    retry: false,
    refetchInterval: ({ state }) => (pacing(state.data) ? REFRESH_MS : false),
  });
  const call = useManagementCall(
    token,
    "fleet",
    "management",
    (result: ManagementLifecycleResult) => result.message,
  );
  const me = useAuthSession(token);
  const permitted = call.allowed && me.data?.capabilities.includes("management") === true;
  const [input, setInput] = useState("");
  const [sent, setSent] = useState("");
  const pace = parsePace(input);
  const load = query.data;
  const send = (value: string) => {
    setSent(value);
    call.mutate(
      { path: pacePath(target), body: paceBody(value) },
      { onSuccess: () => void query.refetch() },
    );
  };
  const outcome = call.isSuccess
    ? paceOutcome(sent, undefined)
    : call.error
      ? paceOutcome(sent, call.error)
      : undefined;
  const name = `${product}/${channel}`;
  return (
    <div className="mt-2 grid gap-2 text-xs">
      {load === undefined ? null : load.kind === "ok" ? (
        <dl aria-label="Pace" className="m-0 grid grid-cols-[max-content_1fr] gap-x-4">
          <dt className="text-muted">current head</dt>
          <dd className="m-0 font-mono">{paceText(load.progress?.duration_ms ?? null)}</dd>
        </dl>
      ) : (
        <p className="m-0 text-muted">{LOAD_TEXT[load.kind]}</p>
      )}
      {permitted && load?.kind === "ok" && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label="Pace"
              placeholder="2h"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              className={`${field} w-24`}
            />
            <ConfirmButton
              label="Set pace"
              confirm={`Set ${name} pace to ${pace ?? ""}`}
              disabled={pace === undefined || call.isPending}
              onConfirm={() => {
                if (pace !== undefined) {
                  send(pace);
                }
              }}
            />
            {load.progress !== null && (
              <ConfirmButton
                label="Turn off"
                confirm={`Turn off ${name} pace`}
                disabled={call.isPending}
                onConfirm={() => send("off")}
              />
            )}
          </div>
          <p className="m-0 text-muted">A changed pace applies from the next promotion.</p>
        </>
      )}
      {outcome && <Notice tone={outcome.tone}>{outcome.text}</Notice>}
      {load?.kind === "ok" && load.progress !== null && (
        <Progress
          token={token}
          target={target}
          progress={load.progress}
          permitted={permitted}
          refresh={() => void query.refetch()}
        />
      )}
    </div>
  );
};

/** Whether the read shows instances still to start, so it is worth reading again. */
const pacing = (load: PaceLoad | undefined): boolean =>
  load?.kind === "ok" &&
  load.progress !== null &&
  paceStatus(load.progress.instances) !== undefined &&
  paceStatus(load.progress.instances) !== "complete";

/** The eligible time, as the server sent it; unknown when it could not project one. */
const eligible = ({ state, eligible_at_ms }: PaceInstance): string =>
  state === "waiting" || state === "paused"
    ? eligible_at_ms === undefined
      ? "unknown"
      : paceInstant(eligible_at_ms)
    : "";

const detail = ({ state, next_opens_at_ms, early_admission }: PaceInstance): string =>
  [
    state === "paused" && next_opens_at_ms !== undefined
      ? `window opens ${paceInstant(next_opens_at_ms)}`
      : "",
    early_admission ? `admitted early by ${early_admission.actor}: ${early_admission.reason}` : "",
  ]
    .filter(Boolean)
    .join("; ");

/**
 * Where each subscribed instance stands on the current head, as the server
 * reports it, and early admission of one instance with a reason. A confirmed
 * admission reads the progress again.
 */
const Progress = ({
  token,
  target,
  progress,
  permitted,
  refresh,
}: {
  token: string;
  target: PaceChannel;
  progress: PaceProgress;
  permitted: boolean;
  refresh: () => void;
}) => {
  const call = useManagementCall(
    token,
    "fleet",
    "management",
    (result: ManagementLifecycleResult) => result.message,
  );
  const [picked, setPicked] = useState("");
  const [reason, setReason] = useState("");
  const [sent, setSent] = useState("");
  const { instances } = progress;
  const status = paceStatus(instances);
  const started = instances.filter(({ state }) => state === "started").length;
  const candidates = admittable(instances);
  const chosen = candidates.find((entry) => instanceName(entry) === picked);
  const why = reason.trim();
  const outcome = call.isSuccess
    ? admitOutcome(sent, undefined)
    : call.error
      ? admitOutcome(sent, call.error)
      : undefined;
  return (
    <>
      <p className="m-0">
        <span className="font-mono">{progress.release}</span>
        {status === undefined
          ? ": no subscribed instances"
          : `: ${STATUS_TEXT[status]}, ${started} of ${instances.length} started`}
      </p>
      {instances.length > 0 && (
        <div className="overflow-x-auto">
          <table aria-label="Instances" className="border-collapse text-xs">
            <thead>
              <tr>
                <th className={th}>Instance</th>
                <th className={th}>State</th>
                <th className={th}>Eligible</th>
                <th className={th}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {instances.map((entry) => (
                <tr key={instanceName(entry)}>
                  <td className={`${td} font-mono`}>{instanceName(entry)}</td>
                  <td className={`${td} ${entry.state === "paused" ? "text-warning" : ""}`}>
                    {entry.state}
                  </td>
                  <td className={`${td} font-mono whitespace-nowrap`}>{eligible(entry)}</td>
                  <td className={`${td} min-w-48`}>{detail(entry)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="m-0 text-muted">Rollbacks and recall removals are never paced.</p>
      {permitted && candidates.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Instance"
            value={picked}
            onChange={(event) => setPicked(event.target.value)}
            className={field}
          >
            <option value="">Instance</option>
            {candidates.map((entry) => (
              <option key={instanceName(entry)} value={instanceName(entry)}>
                {instanceName(entry)}
              </option>
            ))}
          </select>
          <input
            aria-label="Reason"
            placeholder="Reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className={`${field} w-48`}
          />
          <ConfirmButton
            label="Admit early"
            confirm={`Admit ${picked} early: ${why}`}
            disabled={chosen === undefined || why === "" || call.isPending}
            onConfirm={() => {
              if (chosen !== undefined && why !== "") {
                setSent(instanceName(chosen));
                call.mutate(
                  { path: admitPath(target), body: admitBody(chosen, why) },
                  {
                    onSuccess: () => {
                      setPicked("");
                      setReason("");
                      refresh();
                    },
                  },
                );
              }
            }}
          />
        </div>
      )}
      {outcome && <Notice tone={outcome.tone}>{outcome.text}</Notice>}
    </>
  );
};

export default ChannelPace;
