import { describe, expect, it } from "vitest";
import type { EnvironmentInspectReport, EnvironmentSubscriptionView } from "../api/tenkai.gen";
import { channelTable, environmentRows } from "./configuration";

const sub = (product: string, channel: string, head: string, deployed: string | null) =>
  ({
    product,
    channel,
    head,
    deployed,
    state: deployed === head ? "current" : "behind",
  }) satisfies EnvironmentSubscriptionView;

const env = (
  name: string,
  subscriptions: EnvironmentSubscriptionView[],
  facts: Record<string, string> = {},
): EnvironmentInspectReport => ({
  name,
  id: `tenkai:env:${name}`,
  description: `${name} hosts`,
  execution_note: "",
  facts,
  lease:
    name === "prod-eu"
      ? { held: true, generation: 41, owner: "runtime-1", status: "held" }
      : { held: false, status: "free" },
  subscriptions,
  latest_plan: null,
});

const reports = [
  env("prod-eu", [sub("api", "stable", "1.16.0", "1.14.2"), sub("web", "stable", "3.1.4", null)], {
    region: "eu",
    arch: "arm64",
  }),
  env("edge", [sub("api", "edge", "1.17.0", "1.17.0")]),
  env("prod-us", [sub("api", "stable", "1.16.0", "1.16.0")]),
];

describe("environment rows", () => {
  it("summarizes subscriptions, sorted facts, and lease", () => {
    expect(environmentRows(reports).map((row) => row.name)).toEqual(["edge", "prod-eu", "prod-us"]);
    expect(environmentRows(reports)[1]).toMatchObject({
      channels: ["stable"],
      deployed: 1,
      subscribed: 2,
      facts: "arch=arm64 · region=eu",
      lease: "held · generation 41 · runtime-1",
      plan: "none",
      hold: undefined,
    });
  });

  it("copies an environment delivery hold onto the row", () => {
    const hold = { actor: "ops", held_at: 1_700_000_000_000, reason: "freeze" };
    const [row] = environmentRows([{ ...reports[0]!, delivery_hold: hold }]);
    expect(row?.hold).toBe("held by ops at 2023-11-14T22:13:20.000Z: freeze");
  });

  it("names the window a blocked plan waits for", () => {
    const [row] = environmentRows([
      {
        ...reports[0]!,
        latest_plan: {
          id: "tenkai:plan:pln-22",
          state: "blocked",
          created_at: 0,
          step_count: 1,
          status_detail: "blocked outside the configured maintenance window",
        },
        maintenance: {
          eligibility: "closed",
          next_opens_at_ms: Date.parse("2026-10-24T20:00:00Z"),
          windows: [
            {
              identity: "weeknights",
              timezone: "Europe/Berlin",
              weekdays: [6, 7],
              start: "22:00",
              duration_minutes: 480,
              next_opens_at_ms: Date.parse("2026-10-24T20:00:00Z"),
            },
          ],
        },
      },
    ]);
    expect(row?.plan).toBe("waiting window weeknights");
  });
});

describe("channel table", () => {
  it("reports each channel's head and who follows it", () => {
    const table = channelTable(reports);
    expect(table.channels).toEqual(["edge", "stable"]);
    expect(table.products).toEqual(["api", "web"]);
    expect(table.head("api", "stable")).toBe("1.16.0");
    expect(table.subscribers("api", "stable")).toEqual(["prod-eu", "prod-us"]);
    expect(table.head("web", "edge")).toBeUndefined();
  });
});
