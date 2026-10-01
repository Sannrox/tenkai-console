import { describe, expect, it } from "vitest";
import { displaySubject } from "./session";

const jwt = (claims: object) => `e30.${btoa(JSON.stringify(claims)).replaceAll("=", "")}.sig`;

describe("displaySubject", () => {
  it("prefers human-readable claims and tolerates junk", () => {
    expect(displaySubject(jwt({ sub: "u-1", preferred_username: "ada" }))).toBe("ada");
    expect(displaySubject(jwt({ sub: "u-1" }))).toBe("u-1");
    expect(displaySubject("not-a-jwt")).toBeUndefined();
    expect(displaySubject(undefined)).toBeUndefined();
  });
});
