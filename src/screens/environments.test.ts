import { describe, expect, it } from "vitest";
import { ApiError } from "../api/http";
import { landingStatus } from "./environments";

describe("landingStatus", () => {
  const base = { loading: false, rows: 0, behind: 0, error: undefined, unknown: false };

  it("says Loading while the fleet is in flight", () => {
    expect(landingStatus({ ...base, loading: true })).toBe("Loading");
  });

  it("says No environments yet on an empty fleet", () => {
    expect(landingStatus(base)).toBe("No environments yet.");
  });

  it("names a failed fleet read without the server path", () => {
    expect(landingStatus({ ...base, error: new ApiError(500, "v1/fleet/status: boom") })).toBe(
      "The fleet list was not loaded.",
    );
  });

  it("names an older server that omits fleet status", () => {
    expect(landingStatus({ ...base, error: new ApiError(404, "not found") })).toBe(
      "This server does not report fleet status.",
    );
    expect(landingStatus({ ...base, error: new ApiError(405, "method not allowed") })).toBe(
      "This server does not report fleet status.",
    );
  });

  it("keeps the table count when a source fails with rows in hand", () => {
    expect(
      landingStatus({ ...base, rows: 4, error: new ApiError(500, "v1/environments: boom") }),
    ).toBe("4 environments · list incomplete");
  });

  it("uses the unknown slot after a lost reconcile", () => {
    expect(landingStatus({ ...base, rows: 12, unknown: true })).toBe(
      "12 environments · outcome unknown",
    );
  });

  it("counts behind environments when the fleet is current enough to say so", () => {
    expect(landingStatus({ ...base, rows: 2, behind: 1 })).toBe("2 environments, 1 behind");
    expect(landingStatus({ ...base, rows: 12, behind: 0 })).toBe("12 environments, all current");
  });
});
