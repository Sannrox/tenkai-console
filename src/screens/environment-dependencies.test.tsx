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
      held_at: 1,
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
