import { describe, expect, it } from "vitest";
import {
  bindingRows,
  grantRows,
  healthByInstance,
  healthRollup,
  instanceHealth,
  instanceHealthView,
  instanceName,
} from "./instances";

const GRAPH = {
  environment: "prod",
  holds: [
    {
      product: "reports",
      release_id: "reports@1.0.0",
      held_at: 1_700_000_000_000,
      contracts: [
        {
          contract: "cache",
          minimum: "1.0.0",
          candidates: ["db-a", "db-b"],
        },
      ],
    },
  ],
  products: [
    {
      product: "db-a",
      version: "16.2.0",
      state: "current",
      requirements: [],
      impact: {},
    },
    {
      product: "db-b",
      version: "16.2.0",
      state: "unhealthy",
      requirements: [],
      impact: {},
    },
    {
      product: "shop",
      version: "2.1.0",
      state: "current",
      requirements: [
        {
          contract: "database",
          minimum: "1.0.0",
          optional: false,
          provider: {
            state: "unique" as const,
            product: "postgres",
            release: "16.2.0",
            contract: "16.2.0",
            instance: "db-a",
          },
        },
      ],
      impact: {},
    },
    {
      product: "reports",
      version: "1.0.0",
      state: "waiting",
      requirements: [
        {
          contract: "database",
          minimum: "1.0.0",
          optional: false,
          provider: {
            state: "unique" as const,
            product: "postgres",
            release: "16.2.0",
            contract: "16.2.0",
            instance: "db-b",
          },
        },
        {
          contract: "cache",
          minimum: "1.0.0",
          optional: false,
          provider: { state: "ambiguous" as const, products: ["db-a", "db-b"] },
        },
      ],
      impact: {},
    },
  ],
};

describe("instanceName", () => {
  it("defaults unnamed subscriptions to the product", () => {
    expect(
      instanceName({ product: "postgres", channel: "stable", head: "1", state: "current" }),
    ).toBe("postgres");
    expect(
      instanceName({
        product: "postgres",
        channel: "stable",
        head: "1",
        state: "current",
        instance: "db-a",
      }),
    ).toBe("db-a");
  });
});

describe("instanceHealth", () => {
  it("keeps n/a when inspect omits health", () => {
    expect(
      instanceHealth({ product: "postgres", channel: "stable", head: "1", state: "current" }),
    ).toEqual({ label: "n/a", tone: "muted" });
    expect(
      instanceHealth({
        product: "postgres",
        channel: "stable",
        head: "1",
        state: "current",
        health: "error",
      }),
    ).toEqual({ label: "error", tone: "bad" });
  });
});

describe("instanceHealthView", () => {
  it("raises healthy to the worst check, and the truncation check is a plain warning", () => {
    expect(
      instanceHealthView({
        health: "healthy",
        health_checks: [{ name: "truncated", state: "warning", message: "output truncated" }],
      }),
    ).toEqual({
      label: "warning",
      tone: "warn",
      checks: [{ name: "truncated", state: "warning", message: "output truncated", tone: "warn" }],
    });
  });

  it("names a failing instance and lists its checks worst first", () => {
    const view = instanceHealthView({
      health: "unhealthy",
      health_checks: [
        { name: "cert", state: "warning", message: "expires soon" },
        { name: "disk", state: "failing", message: "97% full" },
      ],
    });
    expect(view.label).toBe("failing");
    expect(view.tone).toBe("bad");
    expect(view.checks.map((check) => check.name)).toEqual(["disk", "cert"]);
  });

  it("keeps a stale report unknown, never healthy", () => {
    expect(instanceHealthView({ health: "unknown" })).toEqual({
      label: "unknown",
      tone: "bad",
      checks: [],
    });
  });
});

describe("healthRollup", () => {
  it("counts unknown apart from healthy, worst first", () => {
    expect(
      healthRollup([
        { label: "healthy", tone: "ok" },
        { label: "unknown", tone: "bad" },
        { label: "healthy", tone: "ok" },
        { label: "warning", tone: "warn" },
      ]),
    ).toEqual({ label: "1 unknown · 1 warning · 2 healthy", tone: "bad" });
    expect(healthRollup([])).toEqual({ label: "none", tone: "muted" });
  });
});

describe("bindingRows", () => {
  it("renders two instances and two dependents, including unbound and unhealthy", () => {
    const health = healthByInstance([
      {
        product: "postgres",
        instance: "db-a",
        channel: "stable",
        head: "16.2.0",
        deployed: "16.2.0",
        state: "current",
        health: "ok",
      },
      {
        product: "postgres",
        instance: "db-b",
        channel: "stable",
        head: "16.2.0",
        deployed: "16.2.0",
        state: "unhealthy",
        health: "error",
      },
      {
        product: "shop",
        channel: "stable",
        head: "2.1.0",
        deployed: "2.1.0",
        state: "current",
        health: "ok",
      },
      {
        product: "reports",
        channel: "stable",
        head: "1.0.0",
        deployed: "0.9.0",
        state: "waiting",
      },
    ]);
    expect(bindingRows(GRAPH, health)).toEqual([
      {
        dependent: "shop",
        contract: "database",
        boundTo: "db-a",
        boundTone: "ok",
        health: "ok",
        healthTone: "ok",
        grant: "none",
        providerIdentity: "none",
        callerIdentity: "none",
      },
      {
        dependent: "reports",
        contract: "database",
        boundTo: "db-b",
        boundTone: "ok",
        health: "error",
        healthTone: "bad",
        grant: "none",
        providerIdentity: "none",
        callerIdentity: "none",
      },
      {
        dependent: "reports",
        contract: "cache",
        boundTo: "unbound: db-a, db-b",
        boundTone: "bad",
        health: "n/a",
        healthTone: "muted",
        grant: "none",
        providerIdentity: "none",
        callerIdentity: "none",
      },
    ]);
  });

  it("labels a unique edge granted and names both identities", () => {
    const granted = {
      environment: "prod",
      holds: GRAPH.holds,
      products: [
        GRAPH.products[0]!,
        GRAPH.products[1]!,
        {
          product: "shop",
          version: "2.1.0",
          state: "current",
          requirements: [
            {
              contract: "database",
              minimum: "1.0.0",
              optional: false,
              provider: {
                state: "unique" as const,
                product: "postgres",
                release: "16.2.0",
                contract: "16.2.0",
                instance: "db-a",
                granted: true,
              },
            },
          ],
          impact: {},
        },
        GRAPH.products[3]!,
      ],
    };
    const rows = bindingRows(granted, new Map());
    expect(rows[0]).toMatchObject({
      dependent: "shop",
      grant: "granted",
      providerIdentity: "tenkai://prod/db-a",
      callerIdentity: "tenkai://prod/shop",
    });
    expect(rows[1]?.grant).toBe("none");
    expect(grantRows(granted)).toEqual([
      {
        instance: "db-a",
        caller: "tenkai://prod/shop",
        contract: "database",
        binding: "shop → db-a",
      },
    ]);
  });

  it("is empty when there are no instances", () => {
    expect(bindingRows({ environment: "lab", holds: [], products: [] }, new Map())).toEqual([]);
  });
});
