import { describe, expect, it, vi } from "vitest";
import { explainPath, fetchExplain, nextChangeLine } from "./explain";

const REPORT = {
  environment: "prod",
  instance: "web",
  blockers: [
    {
      check: "delivery_hold",
      evidence: "held by alice",
      unblock: "tenkaictl env hold prod release",
    },
    { check: "approval", evidence: "plan P needs approval", unblock: "approve plan P" },
  ],
};

const answering = (status: number, body: unknown) =>
  vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));

describe("fetchExplain", () => {
  it("keeps blockers in server order", async () => {
    const load = await fetchExplain("prod", "web", "t", answering(200, REPORT));
    expect(load.kind === "ok" && load.value.blockers.map((blocker) => blocker.check)).toEqual([
      "delivery_hold",
      "approval",
    ]);
  });

  it("reads a missing route as unavailable and 403 as forbidden", async () => {
    expect(await fetchExplain("prod", "web", "t", answering(404, { error: "x" }))).toEqual({
      kind: "unavailable",
    });
    expect(await fetchExplain("prod", "web", "t", answering(403, { error: "x" }))).toEqual({
      kind: "forbidden",
    });
  });

  it("rejects a body that is not this contract", async () => {
    const load = await fetchExplain("prod", "web", "t", answering(200, { blockers: "none" }));
    expect(load).toEqual({ kind: "error", message: "Could not load" });
  });
});

describe("explain helpers", () => {
  it("encodes both path segments", () => {
    expect(explainPath("a b", "w/1")).toBe("v1/environments/a%20b/instances/w%2F1/explain");
  });

  it("names the next change from deployed to head", () => {
    expect(nextChangeLine({ action: "upgrade", deployed: "1.0.0", head: "1.1.0" })).toBe(
      "upgrade 1.0.0 -> 1.1.0",
    );
    expect(nextChangeLine({ action: "install", deployed: null, head: "1.1.0" })).toBe(
      "install 1.1.0",
    );
  });
});
