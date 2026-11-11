// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EnvironmentDependencies } from "./environment-dependencies";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
      impact: {},
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
      impact: { remove: { dependent: "shop", contract: "catalog" } },
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

let root: Root;
let container: HTMLElement;

const settle = async () => {
  for (let round = 0; round < 5; round += 1) {
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
  }
};

const serve = (status: number, body: unknown) => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status })),
  );
};

const render = async (ui: ReactNode) => {
  await act(async () => {
    root.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        {ui}
      </QueryClientProvider>,
    );
  });
  await settle();
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("EnvironmentDependencies", () => {
  it("shows waiting, unmet, and the selected product document", async () => {
    serve(200, GRAPH);
    await render(<EnvironmentDependencies environment="prod" token="token" />);
    expect(container.textContent).toContain("1 waiting");
    expect(container.textContent).toContain("unmet");
    expect(container.textContent).toContain("waiting");
    expect(container.textContent).toContain("reports@1.0.0");
    expect(container.textContent).toContain("held at 2023-11-14T22:13:20.000Z");
    expect(container.textContent).toContain("no known provider");
    expect(container.textContent).toContain("analytics >= 2.0.0");
    const catalog = [...container.querySelectorAll("table tbody tr")].find(
      (row) => row.querySelector("td")?.textContent === "catalog",
    );
    expect(catalog).toBeDefined();
    await act(async () => {
      (catalog as HTMLTableRowElement | undefined)?.click();
    });
    await settle();
    expect(container.textContent).toContain("remove refused: shop requires catalog");
    expect(container.textContent).toContain("postgres@16.2.0");
    expect(container.textContent).not.toMatch(/HTTP \d{3}|\/v1\/|#\d+|—/);
  });

  it("lists two unmet contracts on one hold", async () => {
    serve(200, {
      environment: "prod",
      holds: [
        {
          product: "shop",
          release_id: "shop@2.2.0",
          held_at: 1_700_000_000_000,
          contracts: [
            { contract: "catalog", minimum: "2.0.0" },
            { contract: "inventory", minimum: "1.0.0" },
          ],
        },
      ],
      products: [
        {
          product: "shop",
          version: "2.2.0",
          state: "waiting",
          requirements: [
            {
              contract: "catalog",
              minimum: "2.0.0",
              optional: false,
              provider: { state: "absent" as const },
            },
            {
              contract: "inventory",
              minimum: "1.0.0",
              optional: false,
              provider: { state: "absent" as const },
            },
          ],
          impact: {},
        },
      ],
    });
    await render(<EnvironmentDependencies environment="prod" token="token" />);
    expect(container.textContent).toContain("shop@2.2.0");
    expect(container.textContent).toContain("catalog >= 2.0.0");
    expect(container.textContent).toContain("inventory >= 1.0.0");
    expect(container.textContent).toContain("held at 2023-11-14T22:13:20.000Z");
    expect(container.textContent).toMatch(/no known provider.*no known provider/s);
  });

  it("says none when the graph is empty", async () => {
    serve(200, { environment: "lab", holds: [], products: [] });
    await render(<EnvironmentDependencies environment="lab" token="token" />);
    expect(container.textContent).toMatch(/Dependencies\s*none/);
  });

  it("says the route is missing without a status code", async () => {
    serve(404, { error: "not found" });
    await render(<EnvironmentDependencies environment="prod" token="token" />);
    expect(container.textContent).toContain("This server does not report product dependencies.");
    expect(container.textContent).not.toMatch(/HTTP \d{3}|not found/);
  });

  it("says no access when the read is refused", async () => {
    serve(403, { error: "denied" });
    await render(<EnvironmentDependencies environment="prod" token="token" />);
    expect(container.textContent).toContain("No access");
    expect(container.textContent).not.toContain("denied");
  });

  it("renders a binding matrix for two instances and two dependents", async () => {
    serve(200, {
      environment: "prod",
      holds: [],
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
    });
    await render(
      <EnvironmentDependencies
        environment="prod"
        token="token"
        subscriptions={[
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
        ]}
      />,
    );
    expect(container.textContent).toContain("Bindings");
    expect(container.textContent).toContain("db-a");
    expect(container.textContent).toContain("db-b");
    expect(container.textContent).toContain("unbound: db-a, db-b");
    expect(container.textContent).toMatch(/error/);
    expect(container.textContent).toContain("Grants");
    expect(container.querySelector("table[aria-label='Grants']")).toBeNull();
    expect(container.textContent).not.toContain("enforced");
    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent).not.toMatch(/HTTP \d{3}|\/v1\/|#\d+|—/);
  });

  it("shows granted identities and callers, never enforced", async () => {
    serve(200, {
      environment: "prod",
      holds: [],
      products: [
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
      ],
    });
    await render(<EnvironmentDependencies environment="prod" token="token" />);
    expect(container.textContent).toContain("granted");
    expect(container.textContent).toContain("tenkai://prod/db-a");
    expect(container.textContent).toContain("tenkai://prod/shop");
    expect(container.textContent).toContain("shop → db-a");
    expect(container.textContent).not.toContain("enforced");
    expect(container.querySelector("button")).toBeNull();
  });

  it("says could not load when fetch throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await render(<EnvironmentDependencies environment="prod" token="token" />);
    expect(container.textContent).toContain("Could not load");
    expect(container.textContent).not.toContain("Failed to fetch");
    expect(container.textContent).not.toMatch(/\bLoading\b/);
  });
});
