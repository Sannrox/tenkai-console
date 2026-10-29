import { describe, expect, it } from "vitest";
import type {
  ChannelPage,
  EnvironmentInspectReport,
  EnvironmentListEntry,
  EnvironmentSubscriptionView,
  FleetEnvironmentRow,
  FleetStatusReport,
} from "../api/tenkai.gen";
import {
  channelHeadLabel,
  channelMatrix,
  channelTable,
  environmentRows,
  fleetAttention,
  fleetTableRows,
} from "./configuration";
import { visibleRange } from "./window";

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

const fleetRow = (
  name: string,
  fields: Partial<FleetEnvironmentRow> = {},
): FleetEnvironmentRow => ({
  name,
  id: `tenkai:env:${name}`,
  description: "",
  subscription_count: 1,
  products_current: 1,
  products_behind: 0,
  products_missing: 0,
  unhealthy: false,
  health_summary: "ok",
  lease_held: false,
  posture: "current",
  ...fields,
});

describe("fleet table rows", () => {
  it("joins fleet posture with a delivery hold from the list", () => {
    const fleet: FleetStatusReport = {
      environment_count: 2,
      environments: [
        fleetRow("prod-eu", {
          products_current: 1,
          subscription_count: 2,
          products_missing: 1,
          posture: "behind",
        }),
        fleetRow("edge"),
      ],
      environments_behind: 1,
      environments_current: 1,
      environments_empty: 0,
      environments_unhealthy: 0,
    };
    const list: EnvironmentListEntry[] = [
      {
        id: "tenkai:env:prod-eu",
        name: "prod-eu",
        description: "",
        lease_held: false,
        subscription_count: 2,
        deployed_product_count: 1,
        delivery_held: true,
      },
    ];
    const rows = fleetTableRows(fleet, list);
    expect(rows.map((row) => row.name)).toEqual(["edge", "prod-eu"]);
    expect(rows[1]).toMatchObject({
      status: "held",
      statusTone: "warn",
      release: "1/2",
      health: "ok",
      lastApply: "·",
      drift: 0,
    });
  });

  it("shows a plan state when fleet status includes one", () => {
    const fleet: FleetStatusReport = {
      environment_count: 1,
      environments: [fleetRow("edge", { latest_plan_state: "succeeded" })],
      environments_behind: 0,
      environments_current: 1,
      environments_empty: 0,
      environments_unhealthy: 0,
    };
    expect(fleetTableRows(fleet, [])[0]?.lastApply).toBe("succeeded");
  });
});

describe("fleet attention", () => {
  it("lists unhealthy environments from fleet posture, not behind or plan-state rows", () => {
    const items = fleetAttention([
      fleetRow("edge", { posture: "behind", products_behind: 2, products_missing: 0 }),
      fleetRow("core", { posture: "unhealthy", health_summary: "error", unhealthy: true }),
      fleetRow("lab", { latest_plan_state: "blocked", posture: "current" }),
    ]);
    expect(items.map((item) => item.environment)).toEqual(["core"]);
    expect(items[0]).toMatchObject({
      tone: "bad",
      next: "Inspect",
      detail: "error · unhealthy",
    });
  });
});

describe("visible range", () => {
  it("windows a long list so off-screen rows are not rendered", () => {
    expect(visibleRange(1000, 0, 320)).toEqual({ start: 0, end: 34 });
    expect(visibleRange(1000, 3200, 320)).toEqual({ start: 88, end: 122 });
  });

  it("keeps a window inside the list when scroll is past the last row", () => {
    expect(visibleRange(10, 32_000, 320)).toEqual({ start: 0, end: 10 });
    expect(visibleRange(0, 32_000, 320)).toEqual({ start: 0, end: 0 });
  });
});

describe("channel matrix", () => {
  it("reads heads from one channel page and strips the release prefix", () => {
    const page: ChannelPage = {
      items: [
        {
          id: "tenkai:channel:api/stable",
          product: "api",
          name: "stable",
          head: "tenkai:release:api@1.16.0",
        },
        { id: "tenkai:channel:web/edge", product: "web", name: "edge", head: "3.1.4" },
      ],
    };
    const table = channelMatrix(page);
    expect(table.channels).toEqual(["edge", "stable"]);
    expect(table.products).toEqual(["api", "web"]);
    expect(table.cell("api", "stable")).toEqual({ version: "1.16.0" });
    expect(table.cell("web", "stable")).toBeUndefined();
    expect(channelHeadLabel("1.0.0")).toBe("1.0.0");
  });
});
