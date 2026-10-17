import { describe, expect, it } from "vitest";
import { displaySubject, isRefused, useSession } from "./session";

const jwt = (claims: object) => `e30.${btoa(JSON.stringify(claims)).replaceAll("=", "")}.sig`;

describe("displaySubject", () => {
  it("prefers human-readable claims and tolerates junk", () => {
    expect(displaySubject(jwt({ sub: "u-1", preferred_username: "ada" }))).toBe("ada");
    expect(displaySubject(jwt({ sub: "u-1" }))).toBe("u-1");
    expect(displaySubject("not-a-jwt")).toBeUndefined();
    expect(displaySubject(undefined)).toBeUndefined();
  });
});

describe("refusals", () => {
  const session = (accessToken: string) => ({
    kind: "token" as const,
    accessToken,
    subject: undefined,
    expiresAt: undefined,
    refreshToken: undefined,
    idToken: undefined,
  });

  it("ignores a refusal that answers a credential no longer signed in", () => {
    const store = useSession.getState();
    store.signIn(session("read-only"));
    store.refuse("read-only", "fleet", "publish");
    expect(useSession.getState().refused).toStrictEqual([
      { scope: "fleet", capability: "publish" },
    ]);
    expect(isRefused(useSession.getState().refused, "fleet", "publish")).toBe(true);
    expect(isRefused(useSession.getState().refused, "fleet", "management")).toBe(false);
    store.signOut();
    store.signIn(session("admin"));
    store.refuse("read-only", "environment:prod", "management");
    expect(useSession.getState().refused).toStrictEqual([]);
  });
});
