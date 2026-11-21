// Environment delivery metrics against a mocked API. Run with `pnpm build && pnpm e2e`.
import { expect, test, type Page } from "@playwright/test";
import type { EnvironmentInspectReport, FleetStatusReport } from "../src/api/tenkai.gen";
import {
  type MockBackend,
  type Reply,
  type Routes,
  expectDesignRules,
  openApp,
  serveConsole,
} from "./mock-backend";

const FLEET: FleetStatusReport = {
  environments: [
    {
      id: "env:prod",
      name: "prod",
      description: "fixture",
      subscription_count: 2,
      products_current: 1,
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
      product: "api",
      instance: "api",
      channel: "stable",
      head: "1.1.0",
      deployed: "1.0.0",
      state: "unhealthy",
      error: "target failed",
    },
    {
      product: "web",
      instance: "web",
      channel: "stable",
      head: "1.1.0",
      deployed: "1.1.0",
      state: "current",
    },
  ],
} as unknown as EnvironmentInspectReport;

const HOST_ME = {
  principal: "host:uid:1000",
  kind: "human",
  capabilities: ["read"],
  user: "alice",
  groups: ["tenkai-viewer"],
  source: "host",
};

const SINCE = Date.parse("2026-10-22T00:00:00.000Z");
const UNTIL = Date.parse("2026-11-21T00:00:00.000Z");

const FULL = {
  environment: "prod",
  since_ms: SINCE,
  until_ms: UNTIL,
  missing_data: false,
  rows: [
    {
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
    },
    {
      product: "web",
      channel: "stable",
      deployments: 4,
      change_attempts: 4,
      change_failures: 0,
      change_failure_rate: 0,
      lead_time_ms: 60 * 60 * 1000,
      restores: 0,
      unrestored: 0,
      open_exposures: 0,
    },
  ],
};

const ATTEMPTS = {
  items: [
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
      detail: "",
    },
  ],
};

const ok = (body: unknown): Reply => ({ status: 200, body });

const server = (report: Reply | ((url: URL) => Reply), history: Reply = ok(ATTEMPTS)): Routes => {
  return (path, request) => {
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
      return ok({ environment: "prod", holds: [], products: [] });
    }
    if (path === "/v1/environments/prod/history") {
      return history;
    }
    if (path === "/v1/environments/prod/delivery-report") {
      return typeof report === "function"
        ? report(new URL(request.url ?? "/", "http://local"))
        : report;
    }
    return undefined;
  };
};

const section = (page: Page) => page.getByRole("region", { name: "Delivery metrics" });
const metrics = (page: Page) => page.getByRole("table", { name: "Delivery metrics" });

const openEnvironments = async (page: Page, app: MockBackend) => {
  await page.goto(app.url);
  await openApp(page, "Environments");
  await expect(page.getByRole("heading", { name: "Delivery metrics" })).toBeVisible();
};

test.describe("delivery metrics", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("shows each figure with its period and backing count", async ({ page }) => {
    app = await serveConsole(server(ok(FULL)));
    await openEnvironments(page, app);
    await expect(section(page).getByLabel("Report period")).toHaveText(
      "2026-10-22T00:00:00.000Z to 2026-11-21T00:00:00.000Z",
    );
    const api = metrics(page).getByRole("row").filter({ hasText: "api" });
    await expect(api).toContainText("12");
    await expect(api).toContainText("12 records");
    await expect(api).toContainText("8.3%");
    await expect(api).toContainText("1 of 12");
    await expect(api).toContainText("4h");
    await expect(api).toContainText("2h");
    await expect(api).toContainText("5d");
    await expect(api).toContainText("3 open");
    const web = metrics(page).getByRole("row").filter({ hasText: "web" });
    await expect(web).toContainText("0.0%");
    await expect(web).toContainText("0 of 4");
    await expect(web.getByText("none")).toHaveCount(2);
    const deploys = api.getByRole("link", { name: /12 deploys/ });
    await expect(deploys).toHaveAttribute("href", /instance=api/);
    await deploys.click();
    await expect(page.getByLabel("Instance", { exact: true })).toHaveValue("api");
    await expectDesignRules(page);
    expect(
      app.sent.some(
        (sent) => sent.method === "GET" && sent.path === "/v1/environments/prod/delivery-report",
      ),
    ).toBe(true);
    expect(
      app.sent
        .filter((sent) => sent.path === "/v1/environments/prod/delivery-report")
        .every((sent) => sent.authorization === undefined && !sent.search.includes("since_ms")),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath("delivery-metrics.png"),
      fullPage: true,
    });
  });

  test("lists missing data instead of zeros", async ({ page }) => {
    app = await serveConsole(
      server(
        ok({
          ...FULL,
          missing_data: true,
          rows: FULL.rows.map((row) => ({
            product: row.product,
            channel: row.channel,
            deployments: 0,
            change_attempts: 0,
            change_failures: 0,
            restores: 0,
            unrestored: 0,
            open_exposures: 0,
          })),
        }),
      ),
    );
    await openEnvironments(page, app);
    await expect(section(page).getByText("missing data")).toHaveCount(2);
    await expect(section(page).getByText("0.0%")).toHaveCount(0);
    await expect(metrics(page)).toHaveCount(0);
    await expectDesignRules(page);
  });

  test("shows none for figures with no records", async ({ page }) => {
    app = await serveConsole(
      server(
        ok({
          ...FULL,
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
        }),
      ),
    );
    await openEnvironments(page, app);
    const api = metrics(page).getByRole("row").filter({ hasText: "api" });
    await expect(api.getByText("none")).toHaveCount(3);
    await expect(api).toContainText("12d");
    await expect(api).toContainText("1 open");
    await expect(section(page).getByText("0.0%")).toHaveCount(0);
    await expectDesignRules(page);
  });

  test("says no access when the read is refused", async ({ page }) => {
    app = await serveConsole(server({ status: 403, body: { error: "denied" } }));
    await openEnvironments(page, app);
    await expect(section(page).getByText("No access")).toBeVisible();
    await expect(page.getByText("denied")).toHaveCount(0);
    await expectDesignRules(page);
  });

  test("says an older server does not report metrics", async ({ page }) => {
    app = await serveConsole(server({ status: 404, body: { error: "not found" } }));
    await openEnvironments(page, app);
    await expect(
      section(page).getByText("This server does not report delivery metrics."),
    ).toBeVisible();
    await expect(page.getByText("not found")).toHaveCount(0);
    await expectDesignRules(page);
    await page.screenshot({
      path: test.info().outputPath("delivery-metrics-unavailable.png"),
      fullPage: true,
    });
  });

  test("requests since_ms when 7 days is chosen", async ({ page }) => {
    app = await serveConsole(server(ok(FULL)));
    await openEnvironments(page, app);
    await page.getByRole("combobox", { name: "Period" }).selectOption("7");
    await expect
      .poll(() =>
        app.sent.some(
          (sent) =>
            sent.path === "/v1/environments/prod/delivery-report" &&
            sent.search.includes("since_ms="),
        ),
      )
      .toBe(true);
    await expectDesignRules(page);
  });
});

test.describe("delivery metrics on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("keeps the section inside the viewport", async ({ page }) => {
    app = await serveConsole(server(ok(FULL)));
    await openEnvironments(page, app);
    await expect(section(page).getByText("8.3%")).toBeVisible();
    await expectDesignRules(page);
    await page.screenshot({
      path: test.info().outputPath("delivery-metrics-phone.png"),
      fullPage: true,
    });
  });
});
