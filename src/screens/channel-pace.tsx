import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { ChannelListEntry, ManagementLifecycleResult } from "../api/tenkai.gen";
import { useAuthSession } from "../auth/identity";
import {
  fetchPace,
  paceBody,
  paceChannels,
  paceOutcome,
  pacePath,
  paceText,
  parsePace,
  type PaceChannel,
} from "../delivery/pace";
import { useManagementCall } from "../management/use-management";
import { ConfirmButton, Notice } from "../ui/kit";

const field =
  "min-w-0 rounded-md border border-field bg-white/4 px-2.5 py-1.5 font-mono text-xs text-fg placeholder:text-muted";

const LOAD_TEXT = {
  unavailable: "This server does not report upgrade pace.",
  forbidden: "No access",
  error: "Could not load",
} as const;

/**
 * Upgrade pace on the Releases screen: pick a channel with a head, read the
 * pace on its current head, and set or turn it off. Loaded lazily, and one
 * read per picked channel, so a large catalog costs nothing up front.
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
      {target && <Pace key={picked} token={token} target={target} />}
    </section>
  );
};

/**
 * One channel's pace. The editor is offered only when `/v1/auth/me` grants
 * management and no credential refusal hid it. Each confirmed click is one
 * request; a lost answer reads as unknown and is never resent. A confirmed
 * write reads the pace again.
 */
const Pace = ({ token, target }: { token: string; target: PaceChannel }) => {
  const { product, channel } = target;
  const query = useQuery({
    queryKey: ["channel-pace", token, product, channel],
    queryFn: () => fetchPace(target, token),
    retry: false,
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
          <dd className="m-0 font-mono">{paceText(load.durationMs)}</dd>
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
            {load.durationMs !== null && (
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
    </div>
  );
};

export default ChannelPace;
