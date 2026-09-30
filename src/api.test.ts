import { describe, expect, it } from "vitest";
import { apiBase, fetchHealth } from "./api";

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe("apiBase", () => {
  it("resolves the API root at the origin root", () => {
    expect(apiBase("https://hub.test/ui/assets/index-a1.js", false).href).toBe(
      "https://hub.test/",
    );
  });

  it("resolves the API root behind a proxy prefix", () => {
    expect(
      apiBase("https://hub.test/tenkai/ui/assets/index-a1.js", false).href,
    ).toBe("https://hub.test/tenkai/");
  });

  it("uses the dev server origin in development", () => {
    expect(apiBase("http://localhost:5173/src/main.tsx", true).href).toBe(
      "http://localhost:5173/",
    );
  });
});

describe("fetchHealth", () => {
  const base = new URL("https://hub.test/tenkai/");

  it("calls healthz relative to the API root", async () => {
    let called = "";
    await fetchHealth(base, (input) => {
      called = String(input);
      return json({ status: "ok", profile: "community", capabilities: [] });
    });
    expect(called).toBe("https://hub.test/tenkai/healthz");
  });

  it("accepts a valid status", async () => {
    const result = await fetchHealth(base, () =>
      json({ status: "ok", profile: "community", capabilities: ["a"] }),
    );
    expect(result).toEqual({
      kind: "reachable",
      health: { status: "ok", profile: "community", capabilities: ["a"] },
    });
  });

  it("rejects a malformed status", async () => {
    const result = await fetchHealth(base, () => json({ status: 1 }));
    expect(result.kind).toBe("unreachable");
  });

  it("reports HTTP and network failures", async () => {
    expect((await fetchHealth(base, () => json({}, 503))).kind).toBe(
      "unreachable",
    );
    expect(
      (await fetchHealth(base, () => Promise.reject(new Error("down")))).kind,
    ).toBe("unreachable");
  });
});
