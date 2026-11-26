// Environment object page tabs and deep links. Run with `pnpm build && pnpm e2e`.
import { expect, test, type Page } from "@playwright/test";
import type { FleetStatusReport } from "../src/api/tenkai.gen";
import {
  type MockBackend,
  type Reply,
  type Routes,
  expectDesignRules,
  openActions,
  openApp,
  openEnvironment,
  openEnvironmentTab,
  serveConsole,
} from "./mock-backend";

const ok = (body: unknown): Reply => ({ status: 200, body });

const FLEET: FleetStatusReport = {
  environments: [
    {
      id: "env:prod",
      name: "prod",
      description: "fixture",
      subscription_count: 1,
      products_current: 1,
      products_behind: 0,
      products_missing: 0,
      unhealthy: false,
      health_summary: "ok",
      lease_held: false,
      posture: "current",
    },
  ],
  environment_count: 1,
  environments_current: 1,
  environments_behind: 0,
  environments_unhealthy: 0,
  environments_empty: 0,
};

const OPERATOR_ME = {
  principal: "host:uid:1000",
  kind: "human",
  capabilities: ["read", "management"],
  user: "alice",
  groups: ["tenkai-operator"],
  source: "host",
};

const INSPECT = {
  id: "env:prod",
  name: "prod",
  description: "fixture",
  execution_note: "",
  facts: { region: "eu" },
  lease: { held: true, generation: 4, status: "held" },
  latest_plan: null,
  subscriptions: [
    { product: "web", channel: "stable", head: "1.0.0", deployed: "1.0.0", state: "current" },
  ],
};

const ROLLBACK_INSPECT = {
  ...INSPECT,
  subscriptions: [
    { product: "web", channel: "stable", head: "1.1.0", deployed: "1.1.0", state: "current" },
  ],
  latest_plan: {
    id: "tenkai:plan:1",
    state: "succeeded",
    created_at: 1,
    step_count: 1,
    digest: "sha256:abc",
    steps: [
      {
        id: "s1",
        order: 1,
        product: "web",
        action: "upgrade",
        from: "1.0.0",
        to: "1.1.0",
      },
    ],
  },
};

const server =
  (inspect: unknown = INSPECT): Routes =>
  (path, request) => {
    if (path === "/v1/auth/oidc") {
      return { status: 404, body: { error: "no oidc client" } };
    }
    if (path === "/v1/auth/me") {
      return ok(OPERATOR_ME);
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
    if (path === "/v1/environments/prod/hold") {
      return request.method === "POST"
        ? ok({ version: 1, operation: "hold", message: "held prod" })
        : ok({ audit: [] });
    }
    if (path === "/v1/environments/prod/rollback") {
      return ok({ version: 1, operation: "rollback", message: "rolling back prod" });
    }
    if (path === "/v1/environments/prod/retire") {
      return ok({ version: 1, operation: "retire", message: "retired prod" });
    }
    if (path === "/v1/environments/prod/runtime") {
      return ok({ environment: "prod", components: [] });
    }
    if (path === "/v1/environments/prod/dependencies") {
      return ok({ environment: "prod", holds: [], products: [] });
    }
    if (path === "/v1/environments/prod/history") {
      return ok({ items: [] });
    }
    if (path === "/v1/environments/prod/status") {
      return ok([]);
    }
    return undefined;
  };

const tabs = (page: Page) => page.getByRole("navigation", { name: "Environment" });
const shot = (page: Page, name: string) =>
  page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });

test.describe("environment object page", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("list stays, object tabs have their own URLs", async ({ page }) => {
    app = await serveConsole(server());
    await page.goto(app.url);
    await openApp(page, "Environments");
    await expect(page.getByRole("heading", { name: "Environments" })).toBeVisible();
    await openEnvironment(page);
    await expect(page.getByRole("heading", { name: "prod", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open plan" })).toHaveCount(0);
    await expect((await openActions(page)).getByRole("link", { name: "Open plan" })).toBeVisible();
    await page.getByRole("button", { name: "Actions" }).click();
    await expect(tabs(page).getByRole("link", { name: "Overview" })).toBeVisible();
    expect(new URL(page.url()).pathname.endsWith("/environments/prod")).toBe(true);
    await openEnvironmentTab(page, "Instances");
    expect(new URL(page.url()).pathname.endsWith("/environments/prod/instances")).toBe(true);
    await openEnvironmentTab(page, "History");
    expect(new URL(page.url()).pathname.endsWith("/environments/prod/history")).toBe(true);
    await openEnvironmentTab(page, "Settings");
    expect(new URL(page.url()).pathname.endsWith("/environments/prod/settings")).toBe(true);
    await expect(page.getByLabel("Facts configured")).toHaveText("region=eu");
    await openEnvironmentTab(page, "Security");
    expect(new URL(page.url()).pathname.endsWith("/environments/prod/security")).toBe(true);
    await openEnvironmentTab(page, "Linked");
    expect(new URL(page.url()).pathname.endsWith("/environments/prod/linked")).toBe(true);
    await expect(page.getByRole("heading", { name: "Dependencies" })).toBeVisible();
    await shot(page, "env-linked");
    await openEnvironmentTab(page, "Overview");
    await expect(page.getByRole("columnheader", { name: "Deployed" })).toBeVisible();
    await shot(page, "env-overview");
    await openEnvironmentTab(page, "Settings");
    await expect(page.getByLabel("Facts configured")).toBeVisible();
    await shot(page, "env-settings");
    await expectDesignRules(page);
  });

  test("deep links land on the object and History tab", async ({ page }) => {
    app = await serveConsole(server());
    await page.goto(`${app.url}environments?environment=prod`);
    await expect(page.getByRole("heading", { name: "prod", exact: true })).toBeVisible();
    expect(new URL(page.url()).pathname.endsWith("/environments/prod")).toBe(true);
    await page.goto(`${app.url}environments?environment=prod&instance=web`);
    await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
    expect(new URL(page.url()).search).toContain("instance=web");
    await expectDesignRules(page);
  });

  test("hold from Actions keeps the current request", async ({ page }) => {
    app = await serveConsole(server());
    await page.goto(app.url);
    await openEnvironment(page);
    await page.getByRole("button", { name: "Actions" }).click();
    await page.getByRole("button", { name: "Hold delivery" }).click();
    await page.getByLabel("Hold reason").fill("freeze");
    await page.getByRole("button", { name: "Hold", exact: true }).click();
    const sent = page.waitForRequest((request) =>
      request.url().endsWith("/environments/prod/hold"),
    );
    await page.getByRole("button", { name: "Hold prod" }).click();
    expect((await sent).postDataJSON()).toStrictEqual({
      version: 1,
      operation: "hold",
      environment: "prod",
      expected_generation: 4,
      reason: "freeze",
    });
    expect(
      app.sent.filter((call) => call.method === "POST" && call.path.endsWith("/hold")),
    ).toHaveLength(1);
    await expectDesignRules(page);
  });

  test("roll back from Actions keeps the current request", async ({ page }) => {
    app = await serveConsole(server(ROLLBACK_INSPECT));
    await page.goto(app.url);
    await openEnvironment(page);
    await page.getByRole("button", { name: "Actions" }).click();
    await page.getByRole("button", { name: "Roll back" }).click();
    await page.getByRole("button", { name: "Roll back" }).click();
    await page.getByLabel("Reason").fill("bad canary");
    await page.getByLabel("Type prod to confirm").fill("prod");
    const sent = page.waitForRequest((request) =>
      request.url().endsWith("/environments/prod/rollback"),
    );
    await page.getByRole("dialog").getByRole("button", { name: "Roll back" }).click();
    expect((await sent).postDataJSON()).toStrictEqual({
      version: 1,
      operation: "rollback",
      environment: "prod",
      product: "web",
      expected_generation: 4,
      recovery_reason: "bad canary",
    });
    expect(
      app.sent.filter((call) => call.method === "POST" && call.path.endsWith("/rollback")),
    ).toHaveLength(1);
    await expectDesignRules(page);
  });

  test("retire from Actions keeps the current request", async ({ page }) => {
    app = await serveConsole(server());
    await page.goto(app.url);
    await openEnvironment(page);
    await page.getByRole("button", { name: "Actions" }).click();
    await page.getByRole("button", { name: "Retire" }).click();
    await page.getByLabel("Retirement reason").fill("done");
    const sent = page.waitForRequest((request) =>
      request.url().endsWith("/environments/prod/retire"),
    );
    await page.getByRole("button", { name: "Retire" }).click();
    expect((await sent).postDataJSON()).toStrictEqual({
      version: 1,
      operation: "retire",
      reason: "done",
    });
    expect(
      app.sent.filter((call) => call.method === "POST" && call.path.endsWith("/retire")),
    ).toHaveLength(1);
    await expectDesignRules(page);
  });
});

test.describe("environment object page on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("tabs fit without leaking internals", async ({ page }) => {
    app = await serveConsole(server());
    await page.goto(app.url);
    await openEnvironment(page);
    await expect(tabs(page).getByRole("link", { name: "Overview" })).toBeVisible();
    await shot(page, "phone-env");
    await expectDesignRules(page);
  });
});
