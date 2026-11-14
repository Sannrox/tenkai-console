import { describe, expect, it } from "vitest";
import type { ApplyCancelResult, ManagementLifecycleResult } from "../api/tenkai.gen";
import { cancelNotice, cancelOutcome, cancelState } from "./apply-cancel";

const held = (generation: number) => ({ held: true, status: "active", generation });
const free = { held: false, status: "absent" };

describe("cancelState", () => {
  it("offers cancel only for the apply holding the lease", () => {
    expect(cancelState(held(7), undefined)).toEqual({ kind: "running", generation: 7 });
    expect(cancelState(free, undefined)).toEqual({ kind: "none" });
  });

  it("is cancelling only while the accepted generation still holds the lease", () => {
    expect(cancelState(held(7), { generation: 7, accepted: true })).toEqual({
      kind: "cancelling",
      generation: 7,
    });
    // A newer apply took the lease: offer cancel for it, not the old one.
    expect(cancelState(held(8), { generation: 7, accepted: true })).toEqual({
      kind: "running",
      generation: 8,
    });
    // Refused or unknown: the apply still runs and cancel stays on offer.
    expect(cancelState(held(7), { generation: 7, accepted: false })).toEqual({
      kind: "running",
      generation: 7,
    });
  });

  it("reports the apply ended once the lease is free", () => {
    expect(cancelState(free, { generation: 7, accepted: true })).toEqual({
      kind: "ended",
      generation: 7,
    });
  });
});

describe("cancelOutcome", () => {
  const result = (cancel?: ApplyCancelResult): ManagementLifecycleResult => ({
    version: 1,
    operation: "cancel",
    message: "asked apply generation 7 to stop",
    ...(cancel === undefined ? {} : { cancel }),
  });

  it("reports a stale cancel with the live generation, never as success", () => {
    const outcome = cancelOutcome(
      result({ outcome: "stale", live_generation: 8, hold_set: false }),
    );
    expect(outcome).toEqual({ kind: "stale", live: 8 });
    expect(cancelNotice(outcome, 7, "prod", "asked apply generation 7 to stop")).toEqual({
      tone: "unknown",
      text: "Not cancelled. Generation 7 is not the live apply; generation 8 is.",
    });
  });

  it("shows the hold a matched cancel set", () => {
    const withHold = cancelOutcome(
      result({ outcome: "matched", live_generation: 7, hold_set: true }),
    );
    expect(cancelNotice(withHold, 7, "prod", "")).toEqual({
      tone: "ok",
      text: "Cancel accepted for generation 7. prod is held.",
    });
    const unheld = cancelOutcome(
      result({ outcome: "matched", live_generation: 7, hold_set: false }),
    );
    expect(cancelNotice(unheld, 7, "prod", "").text).toBe("Cancel accepted for generation 7.");
  });

  it("shows an older server's message as sent", () => {
    expect(cancelOutcome(result())).toEqual({ kind: "untyped" });
    expect(cancelOutcome(null)).toEqual({ kind: "untyped" });
  });
});
