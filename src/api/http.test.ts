import { describe, expect, it } from "vitest";
import { ApiError, checkServer, fetchOidcSettings, locate, request } from "./http";

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe("locate", () => {
  it("finds console and API roots at the origin root and behind a proxy prefix", () => {
    const root = locate("https://hub.test/ui/assets/index-a1.js", false);
    expect([root.consoleRoot.href, root.apiRoot.href]).toEqual([
      "https://hub.test/ui/",
      "https://hub.test/",
    ]);
    const prefixed = locate("https://hub.test/tenkai/ui/assets/index-a1.js", false);
    expect(prefixed.apiRoot.href).toBe("https://hub.test/tenkai/");
  });

  it("uses the dev server origin in development", () => {
    expect(locate("http://localhost:5173/src/main.tsx", true).consoleRoot.href).toBe(
      "http://localhost:5173/",
    );
  });
});

describe("request", () => {
  it("sends the bearer token and surfaces the server error text", async () => {
    let auth: string | null = null;
    const error = await request("v1/fleet/status", { token: "t-1" }, (_, init) => {
      auth = new Headers(init?.headers).get("authorization");
      return json({ error: "invalid management credential" }, 403);
    }).catch((caught: unknown) => caught);
    expect(auth).toBe("Bearer t-1");
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 403, message: "invalid management credential" });
  });
});

describe("checkServer", () => {
  const health = (contracts?: string[]) => () =>
    json({
      status: "ok",
      profile: "community-sqlite",
      capabilities: [],
      ...(contracts ? { contracts } : {}),
    });

  it("is ready only when the server serves our contract", async () => {
    expect(await checkServer(health(["tenkai.http.v1"]))).toEqual({
      kind: "ready",
      profile: "community-sqlite",
    });
    expect(await checkServer(health(["tenkai.http.v0"]))).toEqual({ kind: "too-old" });
    expect(await checkServer(health())).toEqual({ kind: "too-old" });
  });

  it("reports unreachable and malformed servers", async () => {
    expect((await checkServer(() => Promise.reject(new Error("down")))).kind).toBe("unreachable");
    expect((await checkServer(() => json({ status: 1 }))).kind).toBe("unreachable");
    expect((await checkServer(() => json({}, 503))).kind).toBe("unreachable");
  });
});

describe("fetchOidcSettings", () => {
  it("returns null when the server has no OIDC client", async () => {
    expect(
      await fetchOidcSettings(() => json({ error: "OIDC is not configured" }, 404)),
    ).toBeNull();
    await expect(fetchOidcSettings(() => json({}, 500))).rejects.toBeInstanceOf(ApiError);
  });
});
