import { describe, expect, it } from "vitest";
import { ApiError } from "../api/http";
import type { ChannelListEntry } from "../api/tenkai.gen";
import {
  admitBody,
  admitOutcome,
  admittable,
  configuredPace,
  fetchPace,
  type PaceInstance,
  paceChannels,
  paceInstant,
  paceOutcome,
  paceRows,
  paceStatus,
  paceText,
  parsePace,
} from "./pace";

const answering = (status: number, body: unknown) => (): Promise<Response> =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

const target = { product: "api", channel: "a/b" };

describe("fetchPace", () => {
  it("reads the current head's pace and progress from its own encoded route", async () => {
    const load = await fetchPace(target, "t", (input) => {
      expect(input instanceof URL ? input.href : JSON.stringify(input)).toMatch(
        /\/v1\/products\/api\/channels\/a%2Fb\/pace$/,
      );
      return answering(200, {
        release: "api@1.0.0",
        duration_ms: 7_200_000,
        promoted_at_ms: 1,
        instances: [
          { environment: "stage", instance: "api", state: "waiting", eligible_at_ms: 5 },
          {
            environment: "prod",
            instance: "api",
            state: "paused",
            eligible_at_ms: 9,
            next_opens_at_ms: 8,
            early_admission: { action: "admit", actor: "alice", reason: "hotfix", at: 3 },
          },
        ],
      })();
    });
    expect(load).toMatchObject({
      kind: "ok",
      progress: {
        release: "api@1.0.0",
        duration_ms: 7_200_000,
        instances: [
          { environment: "stage", state: "waiting", eligible_at_ms: 5 },
          { environment: "prod", next_opens_at_ms: 8, early_admission: { actor: "alice" } },
        ],
      },
    });
  });

  it("reads 404 as no pace and 405 as an older server", async () => {
    expect(await fetchPace(target, "t", answering(404, { error: "x" }))).toEqual({
      kind: "ok",
      progress: null,
    });
    expect(await fetchPace(target, "t", answering(405, {}))).toEqual({ kind: "unavailable" });
    expect(await fetchPace(target, "t", answering(403, {}))).toEqual({ kind: "forbidden" });
  });

  it("refuses a body that is not a pace", async () => {
    expect(await fetchPace(target, "t", answering(200, { duration_ms: "2h" }))).toEqual({
      kind: "error",
    });
    const unknownState = {
      release: "api@1",
      duration_ms: 1,
      promoted_at_ms: 1,
      instances: [{ environment: "e", instance: "i", state: "rolling_back" }],
    };
    expect(await fetchPace(target, "t", answering(200, unknownState))).toEqual({ kind: "error" });
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

describe("configured pace", () => {
  const stable = { product: "api", channel: "stable" };
  const entry = (name: string, upgrade_pace_ms?: number): ChannelListEntry => ({
    id: `channel:api/${name}`,
    product: "api",
    name,
    head: "api@1",
    ...(upgrade_pace_ms === undefined ? {} : { upgrade_pace_ms }),
  });

  it("reads the channel's pace, off when omitted, and unknown on a server without the field", () => {
    expect(configuredPace([entry("stable", 7_200_000)], stable)).toBe(7_200_000);
    expect(configuredPace([entry("stable"), entry("beta", 60_000)], stable)).toBeNull();
    expect(configuredPace([entry("stable")], stable)).toBeUndefined();
  });

  it("shows the pace in effect only when it differs from the configured one", () => {
    expect(paceRows(7_200_000, 7_200_000)).toEqual([{ label: "configured", pace: "2h" }]);
    expect(paceRows(null, null)).toEqual([{ label: "configured", pace: "off" }]);
    expect(paceRows(3_600_000, 7_200_000)).toEqual([
      { label: "configured", pace: "1h", note: "applies from the next promotion" },
      { label: "in effect", pace: "2h" },
    ]);
    expect(paceRows(null, 7_200_000)).toEqual([
      { label: "configured", pace: "off", note: "applies from the next promotion" },
      { label: "in effect", pace: "2h" },
    ]);
    expect(paceRows(undefined, 7_200_000)).toEqual([{ label: "current head", pace: "2h" }]);
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

const at = (state: PaceInstance["state"], extra: Partial<PaceInstance> = {}): PaceInstance => ({
  environment: `env-${state}`,
  instance: "api",
  state,
  ...extra,
});

describe("paceStatus", () => {
  it("is complete when all started, paused when every pending instance waits on a window", () => {
    expect(paceStatus([])).toBeUndefined();
    expect(paceStatus([at("started"), at("started")])).toBe("complete");
    expect(paceStatus([at("started"), at("paused")])).toBe("paused");
    expect(paceStatus([at("paused"), at("waiting")])).toBe("in progress");
    expect(paceStatus([at("started"), at("admitted")])).toBe("in progress");
  });
});

describe("early admission", () => {
  it("offers only instances the pace still holds and nobody admitted", () => {
    const early = { actor: "alice", reason: "hotfix", at: 1 };
    expect(
      admittable([
        at("started"),
        at("admitted"),
        at("waiting"),
        at("paused"),
        at("paused", { environment: "env-early", early_admission: early }),
      ]).map(({ environment }) => environment),
    ).toEqual(["env-waiting", "env-paused"]);
  });

  it("sends the instance and reason", () => {
    expect(admitBody(at("waiting"), "canary host")).toEqual({
      version: 1,
      operation: "channel_admit",
      environment: "env-waiting",
      instance: "api",
      reason: "canary host",
    });
  });

  it("never shows the server's text and reads a lost answer as unknown", () => {
    expect(admitOutcome("stage/api", undefined).text).toBe("stage/api admitted early and audited.");
    expect(admitOutcome("stage/api", new TypeError("network")).tone).toBe("unknown");
    expect(admitOutcome("stage/api", new ApiError(503, "x")).tone).toBe("unknown");
    expect(admitOutcome("stage/api", new ApiError(403, "x")).text).toBe("Not permitted.");
    expect(admitOutcome("stage/api", new ApiError(409, "store.rs:42"))).toEqual({
      tone: "bad",
      text: "Admission refused.",
    });
  });
});

describe("paceInstant", () => {
  it("names the date, since an eligible time may be days away", () => {
    expect(paceInstant(1_700_013_600_000, "UTC")).toBe("Wed 15 Nov 02:00");
  });
});
