import type { EnvironmentLeaseInspect } from "../api/tenkai.gen";

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
