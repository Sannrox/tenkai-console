import { type } from "arktype";
import { ApiError, request } from "../api/http";
import type { ChannelConfigureRequest, ChannelListEntry } from "../api/tenkai.gen";
import type { Outcome } from "../management/use-management";

/**
 * Channel upgrade pace: the duration over which a promotion's upgrades start.
 * Read from `GET .../pace` (`PaceProgress.duration_ms`, the pace frozen on the
 * current head), set or cleared with `POST .../pace`.
 */

export type PaceLoad =
  | { kind: "ok"; durationMs: number | null }
  | { kind: "unavailable" }
  | { kind: "forbidden" }
  | { kind: "error" };

export type PaceChannel = { product: string; channel: string };

// Only the current pace is read here; progress fields are left to a later view.
const PaceProgress = type({ duration_ms: "number > 0" });

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
        return { kind: "ok", durationMs: null };
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
  return value instanceof type.errors
    ? { kind: "error" }
    : { kind: "ok", durationMs: value.duration_ms };
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
