import { describe, expect, it } from "vitest";
import { ApiError } from "../api/http";
import { failure } from "./use-management";

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
