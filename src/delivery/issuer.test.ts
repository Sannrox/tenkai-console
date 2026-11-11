import { describe, expect, it } from "vitest";
import { parseInspectIssuer } from "./issuer";

const current = {
  fingerprint: "ab",
  generation: 1,
  recipients: ["runtime:prod-a", "recovery"],
};

describe("parseInspectIssuer", () => {
  it("is unavailable when identity_issuer is omitted", () => {
    expect(parseInspectIssuer({ name: "prod" })).toEqual({ kind: "unavailable" });
  });

  it("is none when the field is present and empty", () => {
    expect(parseInspectIssuer({ identity_issuer: {} })).toEqual({ kind: "none" });
    expect(parseInspectIssuer({ identity_issuer: null })).toEqual({ kind: "none" });
  });

  it("lists the current issuer as active", () => {
    expect(parseInspectIssuer({ identity_issuer: { current } })).toEqual({
      kind: "ok",
      rotation: "active",
      requested: "none",
      slots: [
        {
          role: "current",
          fingerprint: "ab",
          generation: "1",
          recipients: "runtime:prod-a, recovery",
        },
      ],
      waiting: [],
    });
  });

  it("marks empty recipients as lost", () => {
    const load = parseInspectIssuer({
      identity_issuer: {
        current: { fingerprint: "ab", generation: 1, recipients: [] },
      },
    });
    expect(load.kind === "ok" ? load.slots[0]?.recipients : undefined).toBe("lost");
  });

  it("names waiting instances, not a count, while the issue step is blocked", () => {
    expect(
      parseInspectIssuer({
        identity_issuer: {
          current,
          next: { fingerprint: "cd", generation: 2, recipients: ["runtime:prod-a"] },
        },
        identity_issuer_waiting: [
          "api (bundle without the next issuer)",
          "web (bundle written too recently)",
          "",
        ],
      }),
    ).toEqual({
      kind: "ok",
      rotation: "blocked",
      requested: "none",
      slots: [
        {
          role: "current",
          fingerprint: "ab",
          generation: "1",
          recipients: "runtime:prod-a, recovery",
        },
        {
          role: "next",
          fingerprint: "cd",
          generation: "2",
          recipients: "runtime:prod-a",
        },
      ],
      waiting: ["api (bundle without the next issuer)", "web (bundle written too recently)"],
    });
  });

  it("treats a previous issuer as the remove step", () => {
    const load = parseInspectIssuer({
      identity_issuer: {
        current,
        previous: { fingerprint: "old", generation: 0, recipients: ["runtime:prod-a"] },
      },
    });
    expect(load.kind === "ok" ? load.rotation : undefined).toBe("remove");
  });

  it("treats a candidate as the add step", () => {
    const load = parseInspectIssuer({
      identity_issuer: {
        candidate: { fingerprint: "ef", generation: 1, recipients: ["runtime:prod-a"] },
        requested: 1,
      },
    });
    expect(load.kind === "ok" ? load.rotation : undefined).toBe("add");
    expect(load.kind === "ok" ? load.requested : undefined).toBe("1");
  });
});
