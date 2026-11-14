import { describe, expect, it, vi } from "vitest";
import { matchLine, selectorLine } from "../delivery/hold";
import { fetchSelectorMatch, holdBySelector, selectorPath } from "./selectors";

const answering = (status: number, body: unknown) =>
  vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));

describe("fetchSelectorMatch", () => {
  it("asks the server and names each environment once", async () => {
    const fetcher = answering(200, [
      { id: "1", name: "stage" },
      { id: "2", name: "prod" },
      { id: "3", name: "prod" },
    ]);
    expect(await fetchSelectorMatch("tier in (web,api)", "t", fetcher)).toStrictEqual({
      kind: "ok",
      value: ["prod", "stage"],
    });
    expect((fetcher.mock.calls[0]![0] as URL).href).toMatch(
      /\/v1\/environments\?selector=tier\+in\+%28web%2Capi%29$/,
    );
    expect(await fetchSelectorMatch("tier=batch", "t", answering(200, []))).toStrictEqual({
      kind: "ok",
      value: [],
    });
  });

  it("shows the offending clause, never the server's text", async () => {
    const refused = {
      error: "selector clause =prod has an empty key",
      reason: { code: "invalid_selector", next: "correct the selector and retry" },
      clause: "=prod",
    };
    expect(await fetchSelectorMatch("tier=web,=prod", "t", answering(400, refused))).toStrictEqual({
      kind: "invalid",
      clause: "=prod",
    });
    expect(
      await fetchSelectorMatch("tier", "t", answering(400, { error: "bad selector" })),
    ).toStrictEqual({ kind: "invalid", clause: undefined });
  });

  it("reads 403 as no access and an older server as unavailable", async () => {
    expect(await fetchSelectorMatch("a=b", "t", answering(403, {}))).toStrictEqual({
      kind: "forbidden",
    });
    expect(await fetchSelectorMatch("a=b", "t", answering(405, {}))).toStrictEqual({
      kind: "unavailable",
    });
    expect(await fetchSelectorMatch("a=b", "t", answering(200, { items: [] }))).toStrictEqual({
      kind: "error",
      message: "Could not load",
    });
  });
});

describe("holdBySelector", () => {
  const call = {
    environments: ["prod", "stage"],
    selector: "tier=web",
    reason: "web freeze",
    observed: { environment: "stage", generation: 4 },
  };

  it("holds each match with the selector, fencing the shown environment by what was shown", async () => {
    const bodies: unknown[] = [];
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      if (init?.method === "POST") {
        bodies.push(JSON.parse(init.body as string));
        return new Response(JSON.stringify({ message: "held" }), { status: 200 });
      }
      expect((input as URL).href).toMatch(/\/v1\/environments\/prod$/);
      return new Response(JSON.stringify({ lease: { held: true, generation: 9, status: "held" } }));
    });
    const steps = await holdBySelector(call, "t", fetcher);
    expect(steps.map((step) => step.outcome.tone)).toStrictEqual(["ok", "ok"]);
    expect(bodies).toStrictEqual([
      {
        version: 1,
        operation: "hold",
        environment: "prod",
        expected_generation: 9,
        reason: "web freeze",
        selector: "tier=web",
      },
      {
        version: 1,
        operation: "hold",
        environment: "stage",
        expected_generation: 4,
        reason: "web freeze",
        selector: "tier=web",
      },
    ]);
  });

  it("stops at a lost answer, reads it as unknown, and never resends", async () => {
    let posts = 0;
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method === "POST") {
        posts += 1;
        throw new TypeError("network");
      }
      return new Response(JSON.stringify({ lease: { held: false, status: "free" } }));
    });
    const steps = await holdBySelector(call, "t", fetcher);
    expect(posts).toBe(1);
    expect(steps).toStrictEqual([
      {
        environment: "prod",
        outcome: {
          tone: "unknown",
          text: "No answer for prod; the outcome is unknown until the next read.",
        },
      },
    ]);
  });

  it("names a refusal in fixed copy", async () => {
    const refusing = (status: number, body: unknown) =>
      vi.fn<typeof fetch>(async (_input, init) =>
        init?.method === "POST"
          ? new Response(JSON.stringify(body), { status })
          : new Response(JSON.stringify({ lease: { held: false, status: "free" } })),
      );
    const first = async (status: number, body: unknown) =>
      (await holdBySelector(call, "t", refusing(status, body)))[0]?.outcome.text;
    expect(await first(409, { error: "environment prod does not match selector tier=web" })).toBe(
      "prod no longer matches the selector. It was not held.",
    );
    expect(
      await first(400, {
        error: "stale",
        reason: { code: "stale_generation", next: "inspect" },
      }),
    ).toBe("prod changed since it was read. It was not held.");
    expect(await first(422, { error: "unknown field `selector`" })).toBe(
      "This server cannot hold by selector.",
    );
    expect(await first(403, { error: "insufficient delivery capability" })).toBe(
      "Not permitted on prod.",
    );
  });
});

describe("selector lines", () => {
  it("names the selector and every environment it resolved to", () => {
    expect(selectorLine({ selector: "tier=web", environments: ["prod", "stage"] })).toBe(
      "tier=web, matched prod, stage",
    );
    expect(matchLine([])).toBe("none");
    expect(selectorPath("a=b")).toBe("v1/environments?selector=a%3Db");
  });
});
