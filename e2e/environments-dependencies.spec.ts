// Environment dependency holds against a mocked API. Run with `pnpm build && pnpm e2e`.
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
    { product: "reports", channel: "stable", head: "1.0.0", deployed: "0.9.0", state: "waiting" },
  ],
} as unknown as EnvironmentInspectReport;

const INSPECT_FRESH = {
  ...INSPECT,
  subscriptions: [
    {
      product: "postgres",
      channel: "stable",
      head: "16.2.0",
      deployed: "16.2.0",
      state: "current",
    },
    { product: "catalog", channel: "stable", head: "1.4.0", deployed: "1.4.0", state: "current" },
    { product: "reports", channel: "stable", head: "1.0.0", deployed: null, state: "waiting" },
  ],
} as unknown as EnvironmentInspectReport;

const INSPECT_RESUMED = {
  ...INSPECT,
  subscriptions: [
    {
      product: "postgres",
      channel: "stable",
      head: "16.2.0",
      deployed: "16.2.0",
      state: "current",
    },
    { product: "catalog", channel: "stable", head: "1.4.0", deployed: "1.4.0", state: "current" },
    { product: "reports", channel: "stable", head: "1.0.0", deployed: "1.0.0", state: "current" },
  ],
} as unknown as EnvironmentInspectReport;

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
          contract: "database",
          minimum: "1.0.0",
          optional: false,
          provider: { state: "unique", product: "postgres", release: "16.2.0", contract: "1.4.0" },
        },
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

const GRAPH_RESUMED = {
  environment: "prod",
  holds: [],
  products: GRAPH.products.map((product) =>
    product.product === "reports"
      ? {
          ...product,
          state: "current",
          requirements: [
            product.requirements[0],
            {
              contract: "analytics",
              minimum: "2.0.0",
              optional: false,
              provider: {
                state: "unique",
                product: "warehouse",
                release: "2.1.0",
                contract: "2.1.0",
              },
            },
          ],
        }
      : product,
  ),
};

const GRAPH_MULTI = {
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
          provider: { state: "absent" },
        },
        {
          contract: "inventory",
          minimum: "1.0.0",
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

const HOST_OPERATOR = { ...HOST_ME, capabilities: ["read", "management"] };

const ok = (body: unknown): Reply => ({ status: 200, body });

const server = (
  dependencies: Reply,
  options: {
    me?: typeof HOST_ME;
    inspect?: EnvironmentInspectReport;
    reconcile?: Routes;
  } = {},
): Routes => {
  const me = options.me ?? HOST_ME;
  const inspect = options.inspect ?? INSPECT;
  return (path, request) => {
    if (path === "/v1/auth/oidc") {
      return { status: 404, body: { error: "no oidc client" } };
    }
    if (path === "/v1/auth/me") {
      return ok(me);
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
      return ok(inspect);
    }
    if (path === "/v1/environments/prod/runtime") {
      return ok({ environment: "prod", components: [] });
    }
    if (path === "/v1/environments/prod/dependencies") {
      return dependencies;
    }
    return options.reconcile?.(path, request);
  };
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
    await expect(page.getByText("reports@1.0.0").first()).toBeVisible();
    await expect(page.getByText("held at 2023-11-14T22:13:20.000Z").first()).toBeVisible();
    await expect(page.getByText("no known provider").first()).toBeVisible();
    await expect(page.getByText("reports@1.0.0, analytics >= 2.0.0")).toBeVisible();
    await expect(page.getByRole("cell", { name: "unmet", exact: true })).toBeVisible();
    const subscriptions = page
      .locator("table")
      .filter({ has: page.getByRole("columnheader", { name: "Deployed" }) });
    await expect(
      subscriptions
        .getByRole("row")
        .filter({ hasText: /^reports/ })
        .getByRole("cell", { name: "0.9.0", exact: true }),
    ).toBeVisible();
    const graph = page
      .locator("table")
      .filter({ has: page.getByRole("columnheader", { name: "Requires" }) });
    await graph
      .getByRole("row")
      .filter({ hasText: /^catalog/ })
      .click();
    await expect(page.getByText("remove refused: shop requires catalog")).toBeVisible();
    await expect(
      graph
        .getByRole("row")
        .filter({ hasText: /^catalog/ })
        .getByRole("cell", {
          name: "postgres@16.2.0",
          exact: true,
        }),
    ).toBeVisible();
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

  test("shows waiting when the held product has not deployed yet", async ({ page }) => {
    app = await serveConsole(server(ok(GRAPH), { inspect: INSPECT_FRESH }));
    await page.goto(app.url);
    await page.getByRole("link", { name: "Environments" }).click();
    const subscriptions = page
      .locator("table")
      .filter({ has: page.getByRole("columnheader", { name: "Deployed" }) });
    await expect(
      subscriptions
        .getByRole("row")
        .filter({ hasText: /^reports/ })
        .getByRole("cell", { name: "waiting", exact: true }),
    ).toBeVisible();
    await expectDesignRules(page);
  });

  test("lists two unmet contracts on one hold", async ({ page }) => {
    app = await serveConsole(server(ok(GRAPH_MULTI)));
    await page.goto(app.url);
    await page.getByRole("link", { name: "Environments" }).click();
    await expect(page.getByText("shop@2.2.0").first()).toBeVisible();
    await expect(page.getByRole("cell", { name: "catalog >= 2.0.0", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "inventory >= 1.0.0", exact: true })).toBeVisible();
    await expect(page.getByText("held at 2023-11-14T22:13:20.000Z").first()).toBeVisible();
    await expect(page.getByText("no known provider").first()).toBeVisible();
    await expectDesignRules(page);
  });

  test("clears the hold after reconcile without a reload", async ({ page }) => {
    let held = true;
    const routes: Routes = (path, request) => {
      if (path === "/v1/reconcile") {
        held = false;
        return ok({ environments: [] });
      }
      return server(ok(held ? GRAPH : GRAPH_RESUMED), {
        me: HOST_OPERATOR,
        inspect: held ? INSPECT : INSPECT_RESUMED,
      })(path, request);
    };
    app = await serveConsole(routes);
    await page.goto(app.url);
    await page.getByRole("link", { name: "Environments" }).click();
    await expect(page.getByText("1 waiting")).toBeVisible();
    await page.getByRole("link", { name: "Delivery" }).click();
    await page.getByRole("button", { name: "Reconcile" }).click();
    await page.getByRole("button", { name: "Run one reconcile tick" }).click();
    await expect(page.getByText("Tick ran: 0 environments")).toBeVisible();
    await page.getByRole("link", { name: "Environments" }).click();
    await expect(page.getByText("1 waiting")).toHaveCount(0);
    await expect(page.getByText("no known provider")).toHaveCount(0);
    await expect(page.getByText("held at 2023-11-14T22:13:20.000Z")).toHaveCount(0);
    const subscriptions = page
      .locator("table")
      .filter({ has: page.getByRole("columnheader", { name: "Deployed" }) });
    await expect(
      subscriptions
        .getByRole("row")
        .filter({ hasText: /^reports/ })
        .getByRole("cell", { name: "1.0.0", exact: true })
        .first(),
    ).toBeVisible();
    await expect(page.getByText("warehouse@2.1.0").first()).toBeVisible();
    expect(app.sent.some((sent) => sent.method === "POST" && sent.path === "/v1/reconcile")).toBe(
      true,
    );
    await expectDesignRules(page);
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

  test("shows instances and the binding matrix", async ({ page }) => {
    const inspect = {
      ...INSPECT,
      subscriptions: [
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
      ],
    } as unknown as EnvironmentInspectReport;
    const graph = {
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
                state: "unique",
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
              provider: { state: "ambiguous", products: ["db-a", "db-b"] },
            },
          ],
          impact: {},
        },
      ],
    };
    app = await serveConsole(server(ok(graph), { inspect }));
    await page.goto(app.url);
    await page.getByRole("link", { name: "Environments" }).click();
    const instances = page
      .locator("table")
      .filter({ has: page.getByRole("columnheader", { name: "Instance" }) });
    await expect(instances.getByRole("cell", { name: "db-a", exact: true })).toBeVisible();
    await expect(instances.getByRole("cell", { name: "db-b", exact: true })).toBeVisible();
    await expect(instances.getByRole("cell", { name: "error", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Bindings" })).toBeVisible();
    const bindings = page
      .locator("table")
      .filter({ has: page.getByRole("columnheader", { name: "Bound to" }) });
    await expect(bindings.getByRole("cell", { name: "shop", exact: true })).toBeVisible();
    await expect(bindings.getByRole("cell", { name: "unbound: db-a, db-b" })).toBeVisible();
    await expect(
      bindings
        .getByRole("row")
        .filter({ hasText: /^reports/ })
        .filter({ hasText: "database" }),
    ).toContainText("error");
    await expectDesignRules(page);
  });

  test("shows granted identities and callers, never enforced", async ({ page }) => {
    const inspect = {
      ...INSPECT,
      subscriptions: [
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
          product: "shop",
          channel: "stable",
          head: "2.1.0",
          deployed: "2.1.0",
          state: "current",
          health: "ok",
        },
      ],
    } as unknown as EnvironmentInspectReport;
    app = await serveConsole(
      server(
        ok({
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
                    state: "unique",
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
        }),
        { inspect },
      ),
    );
    await page.goto(app.url);
    await page.getByRole("link", { name: "Environments" }).click();
    const bindings = page
      .locator("table")
      .filter({ has: page.getByRole("columnheader", { name: "Bound to" }) });
    await expect(bindings.getByRole("cell", { name: "granted", exact: true })).toBeVisible();
    await expect(
      bindings.getByRole("cell", { name: "tenkai://prod/db-a", exact: true }),
    ).toBeVisible();
    await expect(
      bindings.getByRole("cell", { name: "tenkai://prod/shop", exact: true }),
    ).toBeVisible();
    const grants = page
      .locator("table")
      .filter({ has: page.getByRole("columnheader", { name: "Caller" }) });
    await expect(grants.getByRole("cell", { name: "shop → db-a", exact: true })).toBeVisible();
    await expect(page.getByText("enforced")).toHaveCount(0);
    await expect(bindings.getByRole("button")).toHaveCount(0);
    await expectDesignRules(page);
  });

  test("says none when there are no instances", async ({ page }) => {
    const inspect = { ...INSPECT, subscriptions: [] } as unknown as EnvironmentInspectReport;
    app = await serveConsole(
      server(ok({ environment: "prod", holds: [], products: [] }), { inspect }),
    );
    await page.goto(app.url);
    await page.getByRole("link", { name: "Environments" }).click();
    await expect(page.getByText("none").first()).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Instance" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Bindings" })).toHaveCount(0);
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
