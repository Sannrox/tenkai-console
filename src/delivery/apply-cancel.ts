import type { EnvironmentLeaseInspect, ManagementLifecycleResult } from "../api/tenkai.gen";

/**
 * What the cancel section shows. `sent` is the generation of the last cancel
 * this page sent; `accepted` whether the server answered it with success.
 * Only the lease decides running or ended; the cancel message is shown as sent.
 */
export type CancelState =
  | { kind: "none" }
  | { kind: "running"; generation: number }
  | { kind: "cancelling"; generation: number }
  | { kind: "ended"; generation: number };

/** Generation of the apply holding the environment lease, if one is live. */
export const liveGeneration = (lease: EnvironmentLeaseInspect | undefined): number | undefined =>
  lease?.held === true && typeof lease.generation === "number" ? lease.generation : undefined;

export const cancelState = (
  lease: EnvironmentLeaseInspect,
  sent: { generation: number; accepted: boolean } | undefined,
): CancelState => {
  const live = liveGeneration(lease);
  if (live === undefined) {
    return sent === undefined ? { kind: "none" } : { kind: "ended", generation: sent.generation };
  }
  if (sent?.accepted === true && sent.generation === live) {
    return { kind: "cancelling", generation: live };
  }
  return { kind: "running", generation: live };
};

/**
 * What the server said a cancel did. `stale`: the generation sent was not the
 * live apply, so nothing was cancelled. `untyped`: a server without the typed
 * outcome, whose message is shown as sent.
 */
export type CancelOutcome =
  | { kind: "matched"; holdSet: boolean }
  | { kind: "stale"; live: number }
  | { kind: "untyped" };

export const cancelOutcome = (
  result: ManagementLifecycleResult | null | undefined,
): CancelOutcome => {
  const cancel = result?.cancel;
  if (cancel?.outcome === "stale" && typeof cancel.live_generation === "number") {
    return { kind: "stale", live: cancel.live_generation };
  }
  if (cancel?.outcome === "matched") {
    return { kind: "matched", holdSet: cancel.hold_set };
  }
  return { kind: "untyped" };
};

/** Notice for an answered cancel. A stale cancel never reads as success. */
export const cancelNotice = (
  outcome: CancelOutcome,
  sent: number,
  environment: string,
  message: string,
): { tone: "ok" | "unknown"; text: string } => {
  if (outcome.kind === "stale") {
    return {
      tone: "unknown",
      text: `Not cancelled. Generation ${sent} is not the live apply; generation ${outcome.live} is.`,
    };
  }
  if (outcome.kind === "matched") {
    return {
      tone: "ok",
      text: outcome.holdSet
        ? `Cancel accepted for generation ${sent}. ${environment} is held.`
        : `Cancel accepted for generation ${sent}.`,
    };
  }
  return { tone: "ok", text: message };
};
