// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EnvironmentDelivery } from "./environment-delivery";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SINCE = Date.parse("2026-10-22T00:00:00.000Z");
const UNTIL = Date.parse("2026-11-21T00:00:00.000Z");

const ROW = {
  product: "api",
  channel: "stable",
  deployments: 12,
  change_attempts: 12,
  change_failures: 1,
  change_failure_rate: 0.083,
  lead_time_ms: 4 * 60 * 60 * 1000,
  restores: 1,
  unrestored: 0,
  time_to_restore_ms: 2 * 60 * 60 * 1000,
  open_exposures: 3,
  oldest_exposure_age_ms: 5 * 24 * 60 * 60 * 1000,
};

const REPORT = {
  environment: "prod",
  since_ms: SINCE,
  until_ms: UNTIL,
  missing_data: false,
  rows: [ROW],
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
  const rootRoute = createRootRoute({ component: Outlet });
  const route = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => ui,
  });
  const environments = createRoute({
    getParentRoute: () => rootRoute,
    path: "/environments",
    validateSearch: (
      search: Record<string, unknown>,
    ): { environment?: string; instance?: string } => {
      const environment = typeof search.environment === "string" ? search.environment : undefined;
      const instance = typeof search.instance === "string" ? search.instance : undefined;
      return {
        ...(environment === undefined ? {} : { environment }),
        ...(instance === undefined ? {} : { instance }),
      };
    },
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([route, environments]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
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

describe("EnvironmentDelivery", () => {
  it("shows each figure with its period and backing count, linked to history", async () => {
    serve(200, REPORT);
    await render(<EnvironmentDelivery environment="prod" token="token" />);
    expect(container.textContent).toContain("Delivery metrics");
    expect(container.textContent).toContain("2026-10-22T00:00:00.000Z to 2026-11-21T00:00:00.000Z");
    expect(container.textContent).toContain("api");
    expect(container.textContent).toContain("stable");
    expect(container.textContent).toContain("12");
    expect(container.textContent).toContain("12 records");
    expect(container.textContent).toContain("8.3%");
    expect(container.textContent).toContain("1 of 12");
    expect(container.textContent).toContain("4h");
    expect(container.textContent).toContain("2h");
    expect(container.textContent).toContain("1 restored · 0 unrestored");
    expect(container.textContent).toContain("5d");
    expect(container.textContent).toContain("3 open");
    const link = container.querySelector('a[href*="environment=prod"]');
    expect(link?.getAttribute("href")).toContain("instance=api");
    expect(link?.getAttribute("aria-label")).toContain(
      "2026-10-22T00:00:00.000Z to 2026-11-21T00:00:00.000Z",
    );
    expect(container.textContent).not.toMatch(/HTTP \d{3}|\/v1\/|#\d+|—/);
  });

  it("lists missing data instead of zeros", async () => {
    serve(200, {
      ...REPORT,
      missing_data: true,
      rows: [
        {
          ...ROW,
          deployments: 0,
          change_attempts: 0,
          change_failures: 0,
          change_failure_rate: undefined,
        },
      ],
    });
    await render(<EnvironmentDelivery environment="prod" token="token" />);
    expect(container.textContent).toContain("missing data");
    expect(container.textContent).toContain("api");
    expect(container.textContent).not.toContain("8.3%");
    expect(container.textContent).not.toContain("0.0%");
  });

  it("shows none for figures with no records, not zero", async () => {
    serve(200, {
      ...REPORT,
      rows: [
        {
          product: "api",
          channel: "stable",
          deployments: 0,
          change_attempts: 0,
          change_failures: 0,
          restores: 0,
          unrestored: 0,
          open_exposures: 1,
          oldest_exposure_age_ms: 12 * 24 * 60 * 60 * 1000,
        },
      ],
    });
    await render(<EnvironmentDelivery environment="prod" token="token" />);
    expect(container.textContent).toContain("none");
    expect(container.textContent).toContain("12d");
    expect(container.textContent).toContain("1 open");
    expect(container.textContent).not.toContain("0.0%");
    expect(container.textContent).not.toContain("0h");
  });

  it("says the route is missing without a status code", async () => {
    serve(404, { error: "not found" });
    await render(<EnvironmentDelivery environment="prod" token="token" />);
    expect(container.textContent).toContain("This server does not report delivery metrics.");
    expect(container.textContent).not.toMatch(/HTTP \d{3}|not found/);
  });

  it("says no access when the read is refused", async () => {
    serve(403, { error: "denied" });
    await render(<EnvironmentDelivery environment="prod" token="token" />);
    expect(container.textContent).toContain("No access");
    expect(container.textContent).not.toContain("denied");
  });

  it("requests a shorter period when 7 days is chosen", async () => {
    serve(200, REPORT);
    await render(<EnvironmentDelivery environment="prod" token="token" />);
    const select = container.querySelector("select");
    expect(select).not.toBeNull();
    const fetch = vi.mocked(globalThis.fetch);
    const before = fetch.mock.calls.length;
    await act(async () => {
      select!.value = "7";
      select!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    expect(fetch.mock.calls.length).toBeGreaterThan(before);
    const hrefOf = (called: unknown): string =>
      called instanceof URL ? called.href : called instanceof Request ? called.url : "";
    expect(hrefOf(fetch.mock.calls.at(-1)?.[0])).toMatch(/since_ms=/);
    expect(hrefOf(fetch.mock.calls[0]?.[0])).not.toMatch(/since_ms=/);
  });
});
