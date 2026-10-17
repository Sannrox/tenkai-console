import { describe, expect, it } from "vitest";
import { GRANT_SUMMARY } from "./access";

describe("Access grants", () => {
  it("lists publish alongside read and management", () => {
    expect(GRANT_SUMMARY).toBe(
      "read, publish, and management, decided by the server for each request from your groups",
    );
  });
});
