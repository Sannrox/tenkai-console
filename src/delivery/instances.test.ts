import { describe, expect, it } from "vitest";
import { bindingRows, healthByInstance, instanceHealth, instanceName } from "./instances";

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
      },
      {
        dependent: "reports",
        contract: "database",
        boundTo: "db-b",
        boundTone: "ok",
        health: "error",
        healthTone: "bad",
      },
      {
        dependent: "reports",
        contract: "cache",
        boundTo: "unbound: db-a, db-b",
        boundTone: "bad",
        health: "n/a",
        healthTone: "muted",
      },
    ]);
  });

  it("is empty when there are no instances", () => {
    expect(bindingRows({ environment: "lab", holds: [], products: [] }, new Map())).toEqual([]);
  });
});
