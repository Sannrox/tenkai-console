import { describe, expect, it } from "vitest";
import { ApiError } from "../api/http";
import { failure, refusesCredential } from "./use-management";

describe("failure", () => {
  it("shows the server's refusal as sent", () => {
    expect(failure(new ApiError(409, "stale generation 3, lease is at 4"))).toEqual({
      tone: "bad",
      text: "stale generation 3, lease is at 4",
    });
  });

  it("never reads a lost response as success or failure", () => {
    expect(failure(new TypeError("Failed to fetch")).tone).toBe("unknown");
  });
});

describe("refusesCredential", () => {
  it("hides controls only when the credential itself was refused", () => {
    expect(refusesCredential(new ApiError(403, "insufficient delivery capability"))).toBe(true);
    expect(
      refusesCredential(
        new ApiError(403, "environment-scoped credentials cannot call fleet-wide promote"),
      ),
    ).toBe(true);
    expect(refusesCredential(new ApiError(403, "release signature does not verify"))).toBe(false);
    expect(refusesCredential(new ApiError(409, "insufficient delivery capability"))).toBe(false);
  });
});
