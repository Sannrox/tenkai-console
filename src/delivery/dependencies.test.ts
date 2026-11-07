import { describe, expect, it, vi } from "vitest";
import {
  dependencyRows,
  fetchDependencies,
  impactLines,
  parseDependencies,
  providerLine,
  requirementLine,
} from "./dependencies";

const GRAPH = {
  environment: "prod",
  holds: [
    {
      product: "reports",
      release_id: "reports@1.0.0",
      held_at: 1_700_000_000_000,
      contracts: [{ contract: "analytics", minimum: "2.0.0" }],
    },
  ],
  products: [
    {
      product: "postgres",
      version: "16.2.0",
      state: "current",
      requirements: [],
      impact: {
        remove: { dependent: "catalog", contract: "database" },
      },
    },
    {
      product: "catalog",
      version: "1.4.0",
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
            contract: "1.4.0",
          },
        },
      ],
      impact: {
        remove: { dependent: "shop", contract: "catalog" },
      },
    },
    {
      product: "shop",
      version: "2.1.0",
      state: "current",
      requirements: [
        {
          contract: "catalog",
          minimum: "1.2.0",
          optional: false,
          provider: {
            state: "unique" as const,
            product: "catalog",
            release: "1.4.0",
            contract: "1.4.0",
          },
        },
        {
          contract: "payments",
          minimum: "1.0.0",
          optional: true,
          provider: { state: "absent" as const },
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
          contract: "analytics",
          minimum: "2.0.0",
          optional: false,
          provider: { state: "absent" as const },
        },
      ],
      impact: {},
    },
  ],
};

const answering = (status: number, body: unknown) =>
  vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));

describe("parseDependencies", () => {
  it("accepts the recorded environment graph", () => {
    expect(parseDependencies(GRAPH)?.environment).toBe("prod");
    expect(parseDependencies({ environment: "prod" })).toBeUndefined();
  });
});

describe("lines", () => {
  it("names requires, providers, dependents, and remove impact", () => {
    const shop = GRAPH.products[2]!.requirements;
    expect(requirementLine(shop[0]!)).toBe("catalog >= 1.2.0");
    expect(requirementLine(shop[1]!)).toBe("payments >= 1.0.0 optional");
    expect(providerLine(shop[0]!)).toBe("catalog@1.4.0");
    expect(providerLine(shop[1]!)).toBe("absent");
    expect(providerLine(GRAPH.products[3]!.requirements[0]!)).toBe("unmet");
    const rows = dependencyRows(GRAPH);
    expect(rows.map((row) => row.product)).toEqual(["postgres", "catalog", "shop", "reports"]);
    expect(rows[1]).toMatchObject({
      release: "1.4.0",
      requires: "database >= 1.0.0",
      providedBy: "postgres@16.2.0",
      dependents: "shop",
    });
    expect(rows[3]).toMatchObject({
      state: "waiting",
      providedBy: "unmet",
      providedTone: "bad",
      dependents: "none",
    });
    expect(impactLines(GRAPH.products[1]!)).toEqual(["remove refused: shop requires catalog"]);
  });

  it("names ambiguous providers from the API state", () => {
    const requirement = {
      contract: "database",
      minimum: "1.0.0",
      optional: false,
      provider: { state: "ambiguous" as const, products: ["postgres", "postgres-read"] },
    };
    expect(providerLine(requirement)).toBe("ambiguous: postgres, postgres-read");
  });
});

describe("fetchDependencies", () => {
  it("returns the graph without putting the path in the load", async () => {
    const load = await fetchDependencies("prod", "token", answering(200, GRAPH));
    expect(load).toEqual({ kind: "ok", value: GRAPH });
  });

  it("treats a missing route as unavailable", async () => {
    expect(
      await fetchDependencies("prod", "token", answering(404, { error: "not found" })),
    ).toEqual({ kind: "unavailable" });
  });

  it("treats a read refusal as forbidden", async () => {
    expect(await fetchDependencies("prod", "token", answering(403, { error: "denied" }))).toEqual({
      kind: "forbidden",
    });
  });

  it("hides HTTP status text from an unexpected error", async () => {
    expect(await fetchDependencies("prod", "token", answering(500, { error: "boom" }))).toEqual({
      kind: "error",
      message: "boom",
    });
    expect(await fetchDependencies("prod", "token", answering(502, { unexpected: true }))).toEqual({
      kind: "error",
      message: "Could not load",
    });
  });

  it("hides a thrown fetch as could not load", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await fetchDependencies("prod", "token", fetcher)).toEqual({
      kind: "error",
      message: "Could not load",
    });
  });
});
