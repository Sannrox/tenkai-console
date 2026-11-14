// Delivery failures by source and owner, product owner reachability and the
// fleet route flag against a mocked API. Run with `pnpm build && pnpm e2e`.
import { type Page, expect, test } from "@playwright/test";
import type {
  EnvironmentInspectReport,
  FleetEnvironmentRow,
  FleetStatusReport,
  OwnerView,
  WebhookDelivery,
  WebhookEndpoint,
} from "../src/api/tenkai.gen";
import { type MockBackend, type Reply, expectDesignRules, serveConsole } from "./mock-backend";

const ok = (body: unknown): Reply => ({ status: 200, body });

const SHARED = "https://hooks.example.test/shared";
const ENV_ONLY = "https://hooks.example.test/env";
const PRODUCT_ONLY = "https://hooks.example.test/product";

const failed = (
  id: string,
  url: string,
  sources?: WebhookDelivery["sources"],
): WebhookDelivery => ({
  id,
  event: "release.recalled",
  url,
  state: "retrying",
  attempts: 4,
  next_attempt_at: Date.UTC(2026, 10, 14, 12),
  last_error: "connection refused",
  ...(sources === undefined ? {} : { sources }),
});

const PROD = { kind: "environment", name: "prod" } as const;
const API = { kind: "product", name: "api" } as const;

const PRODUCT_UNREACHABLE: OwnerView = {
  contact: "api-team@example.test",
  endpoints: [PRODUCT_ONLY],
  reachability: {
    verdict: "unreachable",
    endpoints: [
      {
        url: PRODUCT_ONLY,
        verdict: "unreachable",
        consecutive_failures: 6,
        last_success_at: Date.UTC(2026, 10, 12, 8),
      },
    ],
  },
};

const fleetRow = (
  name: string,
  fields: Partial<FleetEnvironmentRow> = {},
): FleetEnvironmentRow => ({
  id: `env:${name}`,
  name,
  description: "fixture",
  subscription_count: 1,
  products_current: 1,
  products_behind: 0,
  products_missing: 0,
  unhealthy: false,
  health_summary: "ok",
  lease_held: false,
  posture: "current",
  ...fields,
});

type Fixture = {
  fleet?: FleetEnvironmentRow[];
  deliveries?: Reply;
  productOwner?: OwnerView | null;
  productDeliveries?: Reply;
};

const SUBSCRIPTION = {
  product: "api",
  instance: "api",
  channel: "stable",
  head: "1.1.0",
  deployed: "1.1.0",
  state: "current",
  health: "healthy",
};

const serve = (fixture: Fixture) => {
  const rows = fixture.fleet ?? [fleetRow("prod", { owner: "ops@example.test" })];
  const fleet: FleetStatusReport = {
    environments: rows,
    environment_count: rows.length,
    environments_current: rows.length,
    environments_behind: 0,
    environments_unhealthy: 0,
    environments_empty: 0,
  };
  return serveConsole((path) => {
    if (path === "/v1/auth/oidc") {
      return { status: 404, body: { error: "no oidc client" } };
    }
    if (path === "/v1/auth/me") {
      return ok({
        principal: "host:uid:1000",
        kind: "human",
        capabilities: ["read"],
        user: "alice",
        source: "host",
      });
    }
    if (path === "/v1/fleet/status") {
      return ok(fleet);
    }
    if (path === "/v1/environments") {
      return ok(rows.map((row) => ({ id: row.id, name: row.name, description: "fixture" })));
    }
    if (path === "/v1/channels") {
      return ok({ items: [{ id: "c", name: "stable", product: "api", head: "api@1.1.0" }] });
    }
    if (path === "/v1/events") {
      return ok({ events: [], next_cursor: "0" });
    }
    const inspected = rows.find((row) => path === `/v1/environments/${row.name}`);
    if (inspected) {
      const owner = inspected.owner;
      return ok({
        id: inspected.id,
        name: inspected.name,
        description: "fixture",
        execution_note: "",
        facts: {},
        lease: { held: true, status: "held", generation: 7 },
        latest_plan: null,
        subscriptions: [SUBSCRIPTION],
        ...(owner === undefined ? {} : { owner: { contact: owner, endpoints: [SHARED] } }),
      } as unknown as EnvironmentInspectReport);
    }
    if (path === "/v1/environments/prod/status") {
      return ok([{ ...SUBSCRIPTION, owner: "api-team@example.test" }]);
    }
    if (path === "/v1/environments/prod/history") {
      return ok({ items: [] });
    }
    if (path === "/v1/environments/prod/webhooks/deliveries") {
      return fixture.deliveries ?? ok([]);
    }
    if (path === "/v1/products/api/owner") {
      return ok(fixture.productOwner ?? null);
    }
    if (path === "/v1/products/api/webhooks") {
      return ok([{ url: PRODUCT_ONLY, secret_env: "HOOK_SECRET" } satisfies WebhookEndpoint]);
    }
    if (path === "/v1/products/api/webhooks/deliveries") {
      return fixture.productDeliveries ?? { status: 404, body: { error: "not found" } };
    }
    return undefined;
  });
};

const owner = (page: Page) => page.getByRole("region", { name: "Owner" });
const failures = (page: Page) => page.getByRole("table", { name: "Delivery failures" });

const openEnvironment = async (page: Page, app: MockBackend) => {
  const deliveries = page.waitForResponse((response) =>
    response.url().endsWith("/environments/prod/webhooks/deliveries"),
  );
  await page.goto(app.url);
  await page.getByRole("link", { name: "Environments" }).click();
  await expect(owner(page)).toBeVisible();
  await deliveries;
  await expect(owner(page)).not.toContainText("Loading");
};

const openReleases = async (page: Page, app: MockBackend) => {
  const deliveries = page.waitForResponse((response) =>
    response.url().endsWith("/products/api/webhooks/deliveries"),
  );
  await page.goto(app.url);
  await page.getByRole("link", { name: "Releases" }).click();
  const table = page.getByRole("table", { name: "Product owners" });
  await expect(table).toBeVisible();
  await expect(table).not.toContainText("Loading");
  await deliveries;
};

const capture = (page: Page, name: string) =>
  page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });

test.describe("attributed delivery failures", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  let app: MockBackend;
  test.afterEach(async () => {
    // Every scenario here is read only.
    expect(app.sent.filter((sent) => sent.method !== "GET")).toStrictEqual([]);
    await app.close();
  });

  test("a shared URL names both sources and owners; no source reads unattributed", async ({
    page,
  }) => {
    app = await serve({
      deliveries: ok([
        failed("d1", SHARED, [API, PROD]),
        failed("d2", ENV_ONLY, [PROD]),
        failed("d3", "https://hooks.example.test/old"),
      ]),
    });
    await openEnvironment(page, app);
    const rows = failures(page).getByRole("row");
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(1)).toHaveText(`environment prodops@example.test1${ENV_ONLY}`);
    await expect(rows.nth(2)).toHaveText(
      `environment prodproduct apiops@example.testapi-team@example.test1${SHARED}`,
    );
    await expect(rows.nth(3)).toHaveText("unattributed·1https://hooks.example.test/old");
    await capture(page, "failures-environment");
    await expectDesignRules(page);
  });

  test("an older server without sources keeps today's view and claims nothing", async ({
    page,
  }) => {
    app = await serve({ deliveries: ok([failed("d1", SHARED), failed("d2", ENV_ONLY)]) });
    await openEnvironment(page, app);
    await expect(owner(page).getByRole("table", { name: "Webhook deliveries" })).toBeVisible();
    await expect(failures(page)).toHaveCount(0);
    await expect(owner(page)).not.toContainText("unattributed");
    await expectDesignRules(page);
  });

  test("product owner unreachable, with product failures by source and owner", async ({ page }) => {
    app = await serve({
      productOwner: PRODUCT_UNREACHABLE,
      productDeliveries: ok([failed("d1", SHARED, [PROD, API]), failed("d4", PRODUCT_ONLY, [API])]),
    });
    await openReleases(page, app);
    const reach = page.getByLabel("api reachability");
    await expect(reach).toHaveText("unreachable");
    await expect(reach).toHaveClass(/text-danger/);
    const endpoints = page.getByRole("table", { name: "Endpoint reachability" }).getByRole("row");
    await expect(endpoints.nth(1)).toHaveText(
      `api${PRODUCT_ONLY}unreachable62026-11-12T08:00:00.000Z`,
    );
    const rows = failures(page).getByRole("row");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(1)).toHaveText(
      `environment prodproduct apiops@example.testapi-team@example.test1${SHARED}`,
    );
    await expect(rows.nth(2)).toHaveText(`product apiapi-team@example.test1${PRODUCT_ONLY}`);
    await capture(page, "product-owner-unreachable");
    await expectDesignRules(page);
  });

  test("no permission on product deliveries names the product without the server's text", async ({
    page,
  }) => {
    app = await serve({
      productOwner: PRODUCT_UNREACHABLE,
      productDeliveries: { status: 403, body: { error: "missing product grant api" } },
    });
    await openReleases(page, app);
    await expect(page.getByText("No access to deliveries of api")).toBeVisible();
    await expect(failures(page)).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("missing product grant");
    await capture(page, "product-deliveries-forbidden");
    await expectDesignRules(page);
  });

  test("an older server shows product owners as before", async ({ page }) => {
    app = await serve({ productOwner: { contact: "api-team@example.test", endpoints: [] } });
    await openReleases(page, app);
    const table = page.getByRole("table", { name: "Product owners" });
    await expect(table).toContainText("api-team@example.test");
    await expect(table.getByRole("columnheader", { name: "Reachability" })).toHaveCount(0);
    await expect(page.getByRole("table", { name: "Endpoint reachability" })).toHaveCount(0);
    await expect(page.getByText("Delivery failures")).toHaveCount(0);
    await expectDesignRules(page);
  });
});

test.describe("fleet route flag", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  const table = (page: Page) => page.getByRole("region", { name: "Environments" });

  test("unrouted environments are counted and flagged in Owner", async ({ page }) => {
    app = await serve({
      fleet: [
        fleetRow("edge", { unrouted: true }),
        fleetRow("lab", { unrouted: true }),
        fleetRow("prod", { owner: "ops@example.test" }),
      ],
    });
    await page.goto(app.url);
    await page.getByRole("link", { name: "Environments" }).click();
    await expect(page.getByLabel("Unrouted environments")).toHaveText(
      "2 unrouted: no owner and no webhook endpoint, so failures notify no one",
    );
    await expect(table(page).getByRole("row", { name: /^edge/ })).toContainText("unrouted");
    await expect(table(page).getByRole("row", { name: /^prod/ })).toContainText("ops@example.test");
    await capture(page, "fleet-unrouted");
    await expectDesignRules(page);
  });

  test("an older server without the flag claims nothing", async ({ page }) => {
    app = await serve({ fleet: [fleetRow("edge"), fleetRow("prod")] });
    await page.goto(app.url);
    await page.getByRole("link", { name: "Environments" }).click();
    await expect(table(page).getByRole("row", { name: /^edge/ })).toBeVisible();
    await expect(page.getByLabel("Unrouted environments")).toHaveCount(0);
    await expect(table(page)).not.toContainText("unrouted");
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("delivery failures stay inside the owner section", async ({ page }) => {
    app = await serve({ deliveries: ok([failed("d1", SHARED, [API, PROD])]) });
    await openEnvironment(page, app);
    await failures(page).scrollIntoViewIfNeeded();
    await capture(page, "failures-phone");
    const box = await owner(page).boundingBox();
    expect((box?.x ?? 0) + (box?.width ?? Infinity)).toBeLessThanOrEqual(390);
  });
});
