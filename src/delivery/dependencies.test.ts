import { describe, expect, it, vi } from "vitest";
import {
  dependencyRows,
  fetchDependencies,
  heldAt,
  heldAtLine,
  deployedLabel,
  holdContractProvider,
  holdNeedLine,
  holdProviderLine,
  impactLines,
  parseDependencies,
  providerLine,
  requirementLine,
  waitingLine,
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

  it("keeps named provider instances and hold candidates", () => {
    const parsed = parseDependencies({
      environment: "prod",
      holds: [
        {
          product: "reports",
          release_id: "reports@1.0.0",
          held_at: 1,
          contracts: [{ contract: "cache", minimum: "1.0.0", candidates: ["db-a", "db-b"] }],
        },
      ],
      products: [
        {
          product: "shop",
          state: "current",
          requirements: [
            {
              contract: "database",
              minimum: "1.0.0",
              optional: false,
              provider: {
                state: "unique",
                product: "postgres",
                release: "16.2.0",
                contract: "16.2.0",
                instance: "db-a",
              },
            },
          ],
          impact: {},
        },
      ],
    });
    expect(parsed?.holds[0]?.contracts[0]?.candidates).toEqual(["db-a", "db-b"]);
    expect(parsed?.products[0]?.requirements[0]?.provider).toMatchObject({
      state: "unique",
      instance: "db-a",
    });
  });
});

describe("lines", () => {
  it("names requires, providers, dependents, and remove impact", () => {
    const shop = GRAPH.products[2]!.requirements;
    expect(requirementLine(shop[0]!)).toBe("catalog >= 1.2.0");
    expect(requirementLine(shop[1]!)).toBe("payments >= 1.0.0 optional");
    expect(providerLine(shop[0]!)).toBe("catalog@1.4.0");
    expect(providerLine(shop[1]!)).toBe("absent");
    expect(providerLine(GRAPH.products[3]!.requirements[1]!)).toBe("unmet");
    expect(holdProviderLine(GRAPH.products[3]!.requirements[1]!)).toBe("no known provider");
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
      providedBy: "postgres@16.2.0 · unmet",
      providedTone: "bad",
      dependents: "none",
    });
    expect(impactLines(GRAPH.products[1]!)).toEqual(["remove refused: shop requires catalog"]);
  });

  it("names a provider instance when it differs from the product", () => {
    expect(
      providerLine({
        contract: "database",
        minimum: "1.0.0",
        optional: false,
        provider: {
          state: "unique",
          product: "postgres",
          release: "16.2.0",
          contract: "16.2.0",
          instance: "db-a",
        },
      }),
    ).toBe("db-a postgres@16.2.0");
  });

  it("names ambiguous providers from the API state", () => {
    const requirement = {
      contract: "database",
      minimum: "1.0.0",
      optional: false,
      provider: { state: "ambiguous" as const, products: ["postgres", "postgres-read"] },
    };
    expect(providerLine(requirement)).toBe("unbound: postgres, postgres-read");
    expect(holdProviderLine(requirement)).toBe("unbound: postgres, postgres-read");
  });
});

describe("holds", () => {
  it("names the unmet need and does not invent a provider", () => {
    const hold = GRAPH.holds[0]!;
    expect(heldAt(hold.held_at)).toBe("2023-11-14T22:13:20.000Z");
    expect(holdNeedLine(hold.contracts[0]!)).toBe("analytics >= 2.0.0");
    expect(holdContractProvider(hold, GRAPH.products, hold.contracts[0]!)).toBe(
      "no known provider",
    );
    expect(waitingLine(GRAPH.holds)).toBe("reports@1.0.0, analytics >= 2.0.0");
    expect(heldAtLine(GRAPH.holds)).toBe("2023-11-14T22:13:20.000Z");
  });

  it("keeps two contracts on one hold and one held_at", () => {
    const hold = {
      product: "shop",
      release_id: "shop@2.2.0",
      held_at: 1_700_000_000_000,
      contracts: [
        { contract: "catalog", minimum: "2.0.0" },
        { contract: "inventory", minimum: "1.0.0" },
      ],
    };
    expect(waitingLine([hold])).toBe("shop@2.2.0, catalog >= 2.0.0 · inventory >= 1.0.0");
    expect(holdContractProvider(hold, GRAPH.products, hold.contracts[1]!)).toBe(
      "no known provider",
    );
  });

  it("keeps the running release when a hold has not undeployed it", () => {
    expect(deployedLabel("0.9.0", true)).toBe("0.9.0");
    expect(deployedLabel("1.0.0", false)).toBe("1.0.0");
    expect(deployedLabel(null, true)).toBe("waiting");
    expect(deployedLabel(undefined, false)).toBe("none");
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
