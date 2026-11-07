import { describe, expect, it, vi } from "vitest";
import { fetchAuthSession, hostSession, signInWithHost } from "./identity";
import type { Session } from "./session";

const answering = (status: number, body: unknown) =>
  vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));

const HOST_ME = {
  principal: "host:uid:1000",
  kind: "human",
  capabilities: ["read", "publish", "management"],
  user: "alice",
  groups: ["tenkai-viewer", "tenkai-operator"],
  source: "host",
};

describe("host identity sign-in", () => {
  it("signs in as the host account the server reports, sending no bearer", async () => {
    const fetcher = answering(200, HOST_ME);
    const signIn = vi.fn<(session: Session) => void>();
    expect(await signInWithHost(signIn, fetcher)).toBe(true);
    expect(signIn).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "host", subject: "alice" }),
    );
    const init = fetcher.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
  });

  it("stays signed out when the connection is not a host account", async () => {
    for (const fetcher of [
      // TCP without a credential, and a server that predates the route.
      answering(401, { error: "missing credential" }),
      answering(404, { error: "not found" }),
      // An OIDC or token principal is never taken for a host account.
      answering(200, { principal: "user-42", kind: "human", capabilities: ["read"] }),
      answering(200, { unexpected: true }),
    ]) {
      const signIn = vi.fn<(session: Session) => void>();
      expect(await signInWithHost(signIn, fetcher)).toBe(false);
      expect(signIn).not.toHaveBeenCalled();
    }
  });

  it("reports capabilities for a bearer session without host facts", async () => {
    const me = await fetchAuthSession(
      "token",
      answering(200, { principal: "management", kind: "management", capabilities: ["read"] }),
    );
    expect(me?.capabilities).toEqual(["read"]);
    expect(hostSession(me)).toBeNull();
  });
});
