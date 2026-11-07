// Environment dependency table against a mocked API (#102). Run with `pnpm build && pnpm e2e`.
import { expect, test } from "@playwright/test";
import type { EnvironmentInspectReport, FleetStatusReport } from "../src/api/tenkai.gen";
import {
  type MockBackend,
  type Reply,
  type Routes,
  expectDesignRules,
  serveConsole,
} from "./mock-backend";

const FLEET: FleetStatusReport = {
  environments: [
    {
      id: "env:prod",
      name: "prod",
      description: "fixture",
      subscription_count: 3,
      products_current: 2,
      products_behind: 0,
      products_missing: 1,
      unhealthy: false,
      health_summary: "ok",
      lease_held: false,
      posture: "behind",
    },
  ],
  environment_count: 1,
  environments_current: 0,
  environments_behind: 1,
  environments_unhealthy: 0,
  environments_empty: 0,
};

const INSPECT = {
  id: "env:prod",
  name: "prod",
  description: "fixture",
  execution_note: "",
  facts: {},
  lease: { held: false, status: "free" },
  latest_plan: null,
  subscriptions: [
    {
      product: "postgres",
      channel: "stable",
      head: "16.2.0",
      deployed: "16.2.0",
      state: "current",
    },
    { product: "catalog", channel: "stable", head: "1.4.0", deployed: "1.4.0", state: "current" },
    { product: "reports", channel: "stable", head: "1.0.0", deployed: "1.0.0", state: "waiting" },
  ],
} as unknown as EnvironmentInspectReport;

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
          provider: { state: "unique", product: "postgres", release: "16.2.0", contract: "1.4.0" },
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
          provider: { state: "absent" },
        },
      ],
      impact: {},
    },
  ],
};

const HOST_ME = {
  principal: "host:uid:1000",
  kind: "human",
  capabilities: ["read"],
  user: "alice",
  groups: ["tenkai-viewer"],
  source: "host",
};

const ok = (body: unknown): Reply => ({ status: 200, body });

const server =
  (dependencies: Reply): Routes =>
  (path) => {
    if (path === "/v1/auth/oidc") {
      return { status: 404, body: { error: "no oidc client" } };
    }
    if (path === "/v1/auth/me") {
      return ok(HOST_ME);
    }
    if (path === "/v1/fleet/status") {
      return ok(FLEET);
    }
    if (path === "/v1/environments") {
      return ok([{ id: "env:prod", name: "prod", description: "fixture" }]);
    }
    if (path === "/v1/channels") {
      return ok({ items: [] });
    }
    if (path === "/v1/environments/prod") {
      return ok(INSPECT);
    }
    if (path === "/v1/environments/prod/runtime") {
      return ok({ environment: "prod", components: [] });
    }
    if (path === "/v1/environments/prod/dependencies") {
      return dependencies;
    }
    return undefined;
  };

// Signed-in screens run at desktop width: the top bar's tabs do not fit a phone yet.
test.describe("environment dependencies", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("shows requires, unmet, and the selected product document", async ({ page }) => {
    app = await serveConsole(server(ok(GRAPH)));
    await page.goto(app.url);
    await page.getByRole("link", { name: "Environments" }).click();
    await expect(page.getByRole("heading", { name: "Dependencies" })).toBeVisible();
    await expect(page.getByText("1 waiting")).toBeVisible();
    await expect(page.getByRole("cell", { name: "unmet" })).toBeVisible();
    const graph = page
      .locator("table")
      .filter({ has: page.getByRole("columnheader", { name: "Requires" }) });
    await graph
      .getByRole("row")
      .filter({ hasText: /^catalog/ })
      .click();
    await expect(page.getByText("remove refused: shop requires catalog")).toBeVisible();
    await expect(graph.getByRole("cell", { name: "postgres@16.2.0" })).toBeVisible();
    await expectDesignRules(page);
    expect(
      app.sent.some(
        (sent) => sent.method === "GET" && sent.path === "/v1/environments/prod/dependencies",
      ),
    ).toBe(true);
    expect(
      app.sent
        .filter((sent) => sent.path === "/v1/environments/prod/dependencies")
        .every((sent) => sent.authorization === undefined),
    ).toBe(true);
  });

  test("says none when the graph is empty", async ({ page }) => {
    app = await serveConsole(server(ok({ environment: "prod", holds: [], products: [] })));
    await page.goto(app.url);
    await page.getByRole("link", { name: "Environments" }).click();
    await expect(page.getByText("This server does not report product dependencies.")).toHaveCount(
      0,
    );
    await expect(page.getByText("none").first()).toBeVisible();
    await expectDesignRules(page);
  });

  test("says the route is missing when the server predates it", async ({ page }) => {
    app = await serveConsole(server({ status: 404, body: { error: "not found" } }));
    await page.goto(app.url);
    await page.getByRole("link", { name: "Environments" }).click();
    await expect(page.getByText("This server does not report product dependencies.")).toBeVisible();
    await expect(page.getByText("not found")).toHaveCount(0);
    await expectDesignRules(page);
  });
});
