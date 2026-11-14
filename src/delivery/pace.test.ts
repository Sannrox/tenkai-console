import { describe, expect, it } from "vitest";
import { ApiError } from "../api/http";
import { fetchPace, paceChannels, paceOutcome, paceText, parsePace } from "./pace";

const answering = (status: number, body: unknown) => (): Promise<Response> =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

const target = { product: "api", channel: "a/b" };

describe("fetchPace", () => {
  it("reads the current head's duration from its own encoded route", async () => {
    const load = await fetchPace(target, "t", (input) => {
      expect(input instanceof URL ? input.href : JSON.stringify(input)).toMatch(
        /\/v1\/products\/api\/channels\/a%2Fb\/pace$/,
      );
      return answering(200, {
        release: "api@1.0.0",
        duration_ms: 7_200_000,
        promoted_at_ms: 1,
        instances: [],
      })();
    });
    expect(load).toEqual({ kind: "ok", durationMs: 7_200_000 });
  });

  it("reads 404 as no pace and 405 as an older server", async () => {
    expect(await fetchPace(target, "t", answering(404, { error: "x" }))).toEqual({
      kind: "ok",
      durationMs: null,
    });
    expect(await fetchPace(target, "t", answering(405, {}))).toEqual({ kind: "unavailable" });
    expect(await fetchPace(target, "t", answering(403, {}))).toEqual({ kind: "forbidden" });
  });

  it("refuses a body that is not a pace", async () => {
    expect(await fetchPace(target, "t", answering(200, { duration_ms: "2h" }))).toEqual({
      kind: "error",
    });
  });
});

describe("paceChannels", () => {
  it("offers only channels with a head, sorted", () => {
    expect(
      paceChannels([
        { id: "1", product: "web", name: "stable", head: "web@1" },
        { id: "2", product: "api", name: "stable", head: "api@1" },
        { id: "3", product: "api", name: "dev", head: "" },
      ]),
    ).toEqual([
      { product: "api", channel: "stable" },
      { product: "web", channel: "stable" },
    ]);
  });
});

describe("pace text", () => {
  it("names a pace in the largest whole unit", () => {
    expect([7_200_000, 5_400_000, 90_000, 1_500, null].map(paceText)).toEqual([
      "2h",
      "90m",
      "90s",
      "1500ms",
      "off",
    ]);
  });

  it("accepts only what the server parses as a positive duration", () => {
    expect(["2h", " 30 ", "250ms", "0", "2d", "1.5h", "-1h", "off"].map(parsePace)).toEqual([
      "2h",
      "30",
      "250ms",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe("paceOutcome", () => {
  it("never shows the server's text and reads a lost answer as unknown", () => {
    expect(paceOutcome("2h", undefined).text).toBe("Pace set to 2h and audited.");
    expect(paceOutcome("off", undefined).text).toBe("Pace turned off and audited.");
    expect(paceOutcome("2h", new TypeError("network")).tone).toBe("unknown");
    expect(paceOutcome("2h", new ApiError(502, "x")).tone).toBe("unknown");
    expect(paceOutcome("2h", new ApiError(409, "store.rs:42"))).toEqual({
      tone: "bad",
      text: "Pace change refused.",
    });
    expect(paceOutcome("2h", new ApiError(403, "x")).text).toBe("Not permitted.");
    expect(paceOutcome("2h", new ApiError(405, "x")).text).toBe("This server cannot set a pace.");
  });
});
