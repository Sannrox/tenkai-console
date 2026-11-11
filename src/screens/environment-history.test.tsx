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
import { EnvironmentHistory } from "./environment-history";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PAGE = {
  items: [
    {
      id: "dep:web:2",
      created_at: 1_700_000_001_000,
      instance: "web",
      product: "web",
      from_version: "1.0.0",
      to_version: "1.1.0",
      status: "succeeded",
      action: "upgrade",
      plan_id: "tenkai:plan:prod:2",
      detail: "",
    },
    {
      id: "dep:api:1",
      created_at: 1_700_000_000_000,
      instance: "api",
      product: "api",
      from_version: "1.0.0",
      to_version: "1.1.0",
      status: "failed",
      action: "upgrade",
      plan_id: "tenkai:plan:prod:1",
      detail: "probe failed\nraw output that must stay collapsed",
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

const serve = (
  status: number,
  body: unknown,
  rest?: (url: string) => { status: number; body: unknown },
) => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      const reply = rest?.(url) ?? { status, body };
      return new Response(JSON.stringify(reply.body), { status: reply.status });
    }),
  );
};

const render = async (ui: ReactNode) => {
  const rootRoute = createRootRoute({ component: Outlet });
  const route = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => ui,
  });
  const plan = createRoute({
    getParentRoute: () => rootRoute,
    path: "/environments/$environment/plan",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([route, plan]),
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
  return client;
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

describe("EnvironmentHistory", () => {
  it("lists newest-first attempts with collapsed long detail", async () => {
    serve(200, PAGE);
    await render(
      <EnvironmentHistory
        environment="prod"
        token="token"
        instances={["api", "web"]}
        onInstance={() => undefined}
      />,
    );
    expect(container.textContent).toContain("web");
    expect(container.textContent).toContain("api");
    expect(container.textContent).toContain("1.0.0 -> 1.1.0");
    expect(container.textContent).toContain("succeeded");
    expect(container.textContent).toContain("failed");
    expect(container.textContent).toContain("tenkai:plan:prod:1");
    expect(container.textContent).toContain("probe failed");
    const details = container.querySelector("details");
    expect(details?.open).toBe(false);
    await act(async () => {
      details?.querySelector("summary")?.click();
    });
    expect(details?.open).toBe(true);
    expect(container.textContent).toContain("raw output that must stay collapsed");
    expect(container.textContent).not.toMatch(/HTTP \d{3}|\/v1\/|#\d+|—/);
  });

  it("shows a structured cause without raw until expand, and a failed restore", async () => {
    serve(200, {
      items: [
        {
          id: "dep:api:1",
          created_at: 1_700_000_000_000,
          instance: "api",
          product: "api",
          from_version: "1.0.0",
          to_version: "1.1.0",
          status: "rolled_back",
          action: "upgrade",
          plan_id: "tenkai:plan:prod:1",
          detail: "probe failed; restored 1.0.0",
          cause: {
            phase: "health_probe",
            kind: "probe_failed",
            summary: "probe failed",
            raw: "SECRET=should-stay-collapsed",
            truncated: true,
          },
          restore: {
            phase: "restore",
            kind: "restore_failed",
            summary: "restore failed",
          },
        },
      ],
    });
    await render(
      <EnvironmentHistory
        environment="prod"
        token="token"
        instances={["api"]}
        onInstance={() => undefined}
      />,
    );
    expect(container.textContent).toContain("health_probe · probe_failed: probe failed");
    expect(container.textContent).toContain("truncated");
    expect(container.textContent).toContain("restore_failed: restore failed");
    const details = container.querySelector("details");
    expect(details?.open).toBe(false);
    expect(details?.querySelector("summary")?.textContent).not.toContain(
      "SECRET=should-stay-collapsed",
    );
    await act(async () => {
      details?.querySelector("summary")?.click();
    });
    expect(details?.open).toBe(true);
    expect(container.textContent).toContain("SECRET=should-stay-collapsed");
    expect(container.querySelector(".text-danger")?.textContent).toContain("restore failed");
  });

  it("says none when there are no attempts", async () => {
    serve(200, { items: [] });
    await render(
      <EnvironmentHistory
        environment="prod"
        token="token"
        instances={["api"]}
        onInstance={() => undefined}
      />,
    );
    expect(container.textContent).toMatch(/History[\s\S]*none/);
  });

  it("says the route is missing without a status code", async () => {
    serve(404, { error: "not found" });
    await render(
      <EnvironmentHistory
        environment="prod"
        token="token"
        instances={[]}
        onInstance={() => undefined}
      />,
    );
    expect(container.textContent).toContain("This server does not report deployment history.");
    expect(container.textContent).not.toMatch(/HTTP \d{3}|not found/);
  });

  it("says no access when the read is refused", async () => {
    serve(403, { error: "denied" });
    await render(
      <EnvironmentHistory
        environment="prod"
        token="token"
        instances={[]}
        onInstance={() => undefined}
      />,
    );
    expect(container.textContent).toContain("No access");
    expect(container.textContent).not.toContain("denied");
  });

  it("filters by instance and loads the next cursor page", async () => {
    const onInstance = vi.fn();
    serve(200, { items: PAGE.items.slice(0, 1), next_cursor: "c2" }, (url) => {
      if (url.includes("cursor=c2")) {
        return { status: 200, body: { items: [PAGE.items[1]] } };
      }
      return { status: 200, body: { items: PAGE.items.slice(0, 1), next_cursor: "c2" } };
    });
    await render(
      <EnvironmentHistory
        environment="prod"
        token="token"
        instances={["api", "web"]}
        instance="web"
        onInstance={onInstance}
      />,
    );
    expect(container.textContent).toContain("web");
    expect(container.textContent).not.toContain("probe failed");
    const select = container.querySelector("select");
    expect(select).not.toBeNull();
    await act(async () => {
      select!.value = "api";
      select!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onInstance).toHaveBeenCalledWith("api");
    const more = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "More",
    );
    expect(more).toBeDefined();
    await act(async () => {
      more?.click();
    });
    await settle();
    expect(container.textContent).toContain("probe failed");
  });

  it("reloads from the first page when history is reset", async () => {
    serve(200, PAGE);
    const client = await render(
      <EnvironmentHistory
        environment="prod"
        token="token"
        instances={["api", "web"]}
        onInstance={() => undefined}
      />,
    );
    const fetch = vi.mocked(globalThis.fetch);
    const before = fetch.mock.calls.length;
    await act(async () => {
      await client.resetQueries({ queryKey: ["history"] });
    });
    await settle();
    expect(fetch.mock.calls.length).toBeGreaterThan(before);
  });

  it("keeps More after a failed next page", async () => {
    serve(200, { items: PAGE.items.slice(0, 1), next_cursor: "c2" }, (url) => {
      if (url.includes("cursor=c2")) {
        return { status: 500, body: { error: "boom" } };
      }
      return { status: 200, body: { items: PAGE.items.slice(0, 1), next_cursor: "c2" } };
    });
    await render(
      <EnvironmentHistory
        environment="prod"
        token="token"
        instances={["web"]}
        onInstance={() => undefined}
      />,
    );
    const more = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "More",
    );
    expect(more).toBeDefined();
    await act(async () => {
      more?.click();
    });
    await settle();
    expect(container.textContent).toContain("web");
    expect(container.textContent).toContain("boom");
    expect(
      [...container.querySelectorAll("button")].some((button) => button.textContent === "More"),
    ).toBe(true);
  });
});
