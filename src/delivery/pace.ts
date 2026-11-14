import { type } from "arktype";
import { ApiError, request } from "../api/http";
import type {
  ChannelAdmitRequest,
  ChannelConfigureRequest,
  ChannelListEntry,
} from "../api/tenkai.gen";
import type { Outcome } from "../management/use-management";

/**
 * Channel upgrade pace: the duration over which a promotion's upgrades start.
 * Read from `GET .../pace` (the pace frozen on the current head and where each
 * subscribed instance stands in it), set or cleared with `POST .../pace`, and
 * one instance admitted early with `POST .../admit`. Only upgrades are paced:
 * rollbacks and recall removals never appear in the progress.
 */

const PaceInstance = type({
  environment: "string",
  instance: "string",
  state: "'started' | 'admitted' | 'waiting' | 'paused'",
  // Server times, shown as sent; the browser never projects them.
  "eligible_at_ms?": "number",
  "next_opens_at_ms?": "number",
  "early_admission?": { actor: "string", reason: "string", at: "number" },
});

const PaceProgress = type({
  release: "string",
  duration_ms: "number > 0",
  instances: PaceInstance.array(),
});

export type PaceInstance = typeof PaceInstance.infer;
export type PaceProgress = typeof PaceProgress.infer;

/** `progress` is null when the channel has no pace on its current head. */
export type PaceLoad =
  | { kind: "ok"; progress: PaceProgress | null }
  | { kind: "unavailable" }
  | { kind: "forbidden" }
  | { kind: "error" };

export type PaceChannel = { product: string; channel: string };

export const pacePath = ({ product, channel }: PaceChannel): string =>
  `v1/products/${encodeURIComponent(product)}/channels/${encodeURIComponent(channel)}/pace`;

/**
 * Channels whose pace can be read: those with a head, since the server
 * answers 404 for a channel without one. A 404 for a listed channel then
 * means no pace.
 */
export const paceChannels = (items: readonly ChannelListEntry[]): PaceChannel[] =>
  items
    .filter((item) => item.head !== "")
    .map(({ product, name }) => ({ product, channel: name }))
    .toSorted((a, b) => `${a.product}/${a.channel}`.localeCompare(`${b.product}/${b.channel}`));

/** 200 is the pace, 404 no pace, 405 an older server; nothing raw is shown. */
export const fetchPace = async (
  target: PaceChannel,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<PaceLoad> => {
  let raw: unknown;
  try {
    raw = await request<unknown>(pacePath(target), { token }, fetcher);
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 404) {
        return { kind: "ok", progress: null };
      }
      if (error.status === 405) {
        return { kind: "unavailable" };
      }
      if (error.status === 403) {
        return { kind: "forbidden" };
      }
    }
    return { kind: "error" };
  }
  const value = PaceProgress(raw);
  return value instanceof type.errors ? { kind: "error" } : { kind: "ok", progress: value };
};

const UNITS = [
  ["h", 3_600_000],
  ["m", 60_000],
  ["s", 1_000],
] as const;

/** A pace in the largest unit that divides it, the way the server parses it back. */
export const paceText = (ms: number | null): string => {
  if (ms === null) {
    return "off";
  }
  const unit = UNITS.find(([, size]) => ms % size === 0);
  return unit ? `${ms / unit[1]}${unit[0]}` : `${ms}ms`;
};

const DURATION = /^(\d+)(ms|h|m|s)?$/;

/**
 * The value to send, or undefined when the server would refuse it: a
 * positive whole number with an optional `ms`, `s`, `m`, or `h` (bare is
 * seconds). Off is its own action.
 */
export const parsePace = (input: string): string | undefined => {
  const value = input.trim();
  const match = DURATION.exec(value);
  return match && Number(match[1]) > 0 ? value : undefined;
};

export const paceBody = (pace: string): ChannelConfigureRequest => ({
  version: 1,
  operation: "channel_configure",
  upgrade_pace: pace,
});

/**
 * What a pace write answer means. No answer, or a 5xx that may have landed,
 * is unknown; a refusal says so without the server's text.
 */
export const paceOutcome = (pace: string, error: unknown): Outcome => {
  if (error === undefined) {
    return {
      tone: "ok",
      text: pace === "off" ? "Pace turned off and audited." : `Pace set to ${pace} and audited.`,
    };
  }
  if (!(error instanceof ApiError) || error.status >= 500) {
    return {
      tone: "unknown",
      text: "No answer from the server; the outcome is unknown until the next read.",
    };
  }
  if (error.status === 403) {
    return { tone: "bad", text: "Not permitted." };
  }
  if (error.status === 405) {
    return { tone: "bad", text: "This server cannot set a pace." };
  }
  return { tone: "bad", text: "Pace change refused." };
};

/**
 * Where the channel's pacing stands: complete once every instance runs the
 * head, paused when every instance still to start waits on a closed
 * maintenance window, otherwise in progress. Undefined without instances.
 */
export const paceStatus = (
  instances: readonly PaceInstance[],
): "complete" | "paused" | "in progress" | undefined => {
  if (instances.length === 0) {
    return undefined;
  }
  const pending = instances.filter(({ state }) => state !== "started");
  if (pending.length === 0) {
    return "complete";
  }
  return pending.every(({ state }) => state === "paused") ? "paused" : "in progress";
};

export const instanceName = ({ environment, instance }: PaceInstance): string =>
  `${environment}/${instance}`;

/** Instances still held by the pace and not already admitted early. */
export const admittable = (instances: readonly PaceInstance[]): PaceInstance[] =>
  instances.filter(
    ({ state, early_admission }) =>
      (state === "waiting" || state === "paused") && early_admission === undefined,
  );

/**
 * A server time with its date, in the viewer's zone (or `timeZone` in tests):
 * an eligible time may be days away, so a weekday alone would be ambiguous.
 */
export const paceInstant = (ms: number, timeZone?: string): string => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(new Date(ms));
  const part = (name: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === name)?.value ?? "";
  return `${part("weekday")} ${part("day")} ${part("month")} ${part("hour")}:${part("minute")}`;
};

export const admitPath = ({ product, channel }: PaceChannel): string =>
  `v1/products/${encodeURIComponent(product)}/channels/${encodeURIComponent(channel)}/admit`;

export const admitBody = (
  { environment, instance }: PaceInstance,
  reason: string,
): ChannelAdmitRequest => ({
  version: 1,
  operation: "channel_admit",
  environment,
  instance,
  reason,
});

/**
 * What an early admission answer means, in fixed copy. No answer, or a 5xx
 * that may have landed, is unknown and is never resent.
 */
export const admitOutcome = (name: string, error: unknown): Outcome => {
  if (error === undefined) {
    return { tone: "ok", text: `${name} admitted early and audited.` };
  }
  if (!(error instanceof ApiError) || error.status >= 500) {
    return {
      tone: "unknown",
      text: "No answer from the server; the outcome is unknown until the next read.",
    };
  }
  if (error.status === 403) {
    return { tone: "bad", text: "Not permitted." };
  }
  if (error.status === 405) {
    return { tone: "bad", text: "This server cannot admit early." };
  }
  return { tone: "bad", text: "Admission refused." };
};
