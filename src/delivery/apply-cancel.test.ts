import { describe, expect, it } from "vitest";
import { cancelState } from "./apply-cancel";

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
