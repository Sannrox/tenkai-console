// Stop and start a deployed instance against a mocked API. Run with `pnpm build && pnpm e2e`.
import { type Page, expect, test } from "@playwright/test";
import type { EnvironmentInspectReport, FleetStatusReport } from "../src/api/tenkai.gen";
import {
  type MockBackend,
  type Reply,
  type Routes,
  expectDesignRules,
  openApp,
  serveConsole,
} from "./mock-backend";

const ok = (body: unknown): Reply => ({ status: 200, body });

const OPERATOR = {
  principal: "host:uid:1000",
  kind: "human",
  capabilities: ["read", "management"],
  user: "alice",
  groups: ["tenkai-operator"],
  source: "host",
};

const VIEWER = {
  ...OPERATOR,
  capabilities: ["read"],
  groups: ["tenkai-viewer"],
};

type Life = {
  health: string;
  error?: string;
  action?: "stop" | "start";
  planState?: "computed" | "running" | "blocked";
  me?: typeof OPERATOR;
  stop?: Reply;
  start?: Reply;
};

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

const inspect = (life: Life): EnvironmentInspectReport => ({
  id: "env:prod",
  name: "prod",
  description: "fixture",
  execution_note: "",
  facts: {},
  lease: { held: false, status: "free" },
  latest_plan:
    life.action === undefined
      ? null
      : {
          id: "tenkai:plan:1",
          state: life.planState ?? "running",
          created_at: 1,
          step_count: 1,
          digest: "sha256:abc",
          steps: [
            {
              id: "s1",
              order: 1,
              product: "api",
              action: life.action,
              release_id: "rel:1",
              from: "1.0.0",
              to: "1.0.0",
              instance: "api",
            },
          ],
        },
  subscriptions: [
    {
      product: "api",
      instance: "api",
      channel: "stable",
      head: "1.0.0",
      deployed: "1.0.0",
      state: life.health === "stopped" ? "stopped" : "current",
      health: life.health,
      ...(life.error === undefined ? {} : { error: life.error }),
    },
  ],
});

const server = (life: Life): Routes => {
  const report = inspect(life);
  const me = life.me ?? OPERATOR;
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
      return ok(report);
    }
    if (path === "/v1/environments/prod/status") {
      return ok([
        {
          product: "api",
          instance: "api",
          channel: "stable",
          head: "1.0.0",
          deployed: "1.0.0",
          state: life.health === "stopped" ? "stopped" : "current",
          health: life.health,
          ...(life.error === undefined ? {} : { error: life.error }),
          ...(life.health === "stopped"
            ? { health_checks: [{ name: "http", state: "failing", message: "503 on /ready" }] }
            : {}),
        },
      ]);
    }
    if (path === "/v1/environments/prod/stop") {
      return (
        life.stop ??
        ok({
          version: 1,
          operation: "stop",
          message: "stop plan plan-1 requires signed approval",
          plan_id: "plan-1",
        })
      );
    }
    if (path === "/v1/environments/prod/start") {
      return (
        life.start ??
        ok({
          version: 1,
          operation: "start",
          message: "start plan plan-2 requires signed approval",
          plan_id: "plan-2",
        })
      );
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
    if (request.method === "GET") {
      return undefined;
    }
    return undefined;
  };
};

const instanceRow = (page: Page) =>
  page
    .locator("table")
    .filter({ has: page.getByRole("columnheader", { name: "Deployed" }) })
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: "api", exact: true }) });

const rollup = (page: Page) =>
  page.locator("dt", { hasText: /^health$/ }).locator("xpath=following-sibling::dd[1]");

const capture = (page: Page, name: string) =>
  page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });

const open = async (page: Page, app: MockBackend) => {
  await page.goto(app.url);
  await openApp(page, "Environments");
};

test.describe("stop and start an instance", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("running: stop plans with a reason", async ({ page }) => {
    app = await serveConsole(server({ health: "healthy" }));
    await open(page, app);
    const row = instanceRow(page);
    await expect(row.getByRole("cell", { name: "healthy" })).toBeVisible();
    await expect(row).not.toContainText("failing");
    await page.getByLabel("Stop reason").fill("drain for maintenance");
    await page.getByRole("button", { name: "Stop" }).click();
    const sent = page.waitForRequest((request) =>
      request.url().endsWith("/environments/prod/stop"),
    );
    await page.getByRole("button", { name: "Stop api on prod" }).click();
    expect((await sent).postDataJSON()).toStrictEqual({
      version: 1,
      operation: "stop",
      environment: "prod",
      expected_generation: 0,
      product: "api",
      reason: "drain for maintenance",
    });
    await expect(page.getByText("stop plan plan-1 requires signed approval")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open plan" }).first()).toBeVisible();
    await capture(page, "stop-running");
    await expectDesignRules(page);
  });

  test("stopping: an in-flight stop is not failing", async ({ page }) => {
    app = await serveConsole(server({ health: "healthy", action: "stop", planState: "running" }));
    await open(page, app);
    const row = instanceRow(page);
    await expect(row.getByRole("cell", { name: "stopping" })).toBeVisible();
    await expect(row).not.toContainText("failing");
    await expect(page.getByText("Stopping api.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(0);
    await capture(page, "stop-stopping");
    await expectDesignRules(page);
  });

  test("stopped: never failing or unknown; upgrade is held by stop", async ({ page }) => {
    app = await serveConsole(
      server({
        health: "stopped",
        error: "upgrade held: drain for maintenance",
      }),
    );
    await open(page, app);
    const row = instanceRow(page);
    await expect(row.getByRole("cell", { name: "stopped", exact: true })).toBeVisible();
    await expect(row).not.toContainText("failing");
    await expect(row).not.toContainText("unknown");
    await expect(row).toContainText("upgrade held: drain for maintenance");
    await expect(row.getByRole("button", { name: /Why/ })).toHaveCount(0);
    await expect(rollup(page)).toHaveText("1 stopped");
    await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(0);
    await capture(page, "stop-stopped");
    await expectDesignRules(page);
  });

  test("starting: start of a stopped instance", async ({ page }) => {
    app = await serveConsole(
      server({
        health: "stopped",
        error: "upgrade held: drain for maintenance",
        action: "start",
        planState: "running",
      }),
    );
    await open(page, app);
    await expect(instanceRow(page).getByRole("cell", { name: "starting" })).toBeVisible();
    await expect(page.getByText("Starting api.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Start" })).toHaveCount(0);
    await capture(page, "stop-starting");
    await expectDesignRules(page);
  });

  test("start posts the recorded instance with no reason", async ({ page }) => {
    app = await serveConsole(
      server({ health: "stopped", error: "upgrade held: drain for maintenance" }),
    );
    await open(page, app);
    await page.getByRole("button", { name: "Start" }).click();
    const sent = page.waitForRequest((request) =>
      request.url().endsWith("/environments/prod/start"),
    );
    await page.getByRole("button", { name: "Start api on prod" }).click();
    expect((await sent).postDataJSON()).toStrictEqual({
      version: 1,
      operation: "start",
      environment: "prod",
      expected_generation: 0,
      product: "api",
    });
    await expect(page.getByText("start plan plan-2 requires signed approval")).toBeVisible();
    await expectDesignRules(page);
  });

  test("no permission: a 403 hides stop and start", async ({ page }) => {
    app = await serveConsole(
      server({
        health: "healthy",
        me: VIEWER,
        stop: { status: 403, body: { error: "insufficient delivery capability" } },
      }),
    );
    await open(page, app);
    await page.getByLabel("Stop reason").fill("drain for maintenance");
    await page.getByRole("button", { name: "Stop" }).click();
    await page.getByRole("button", { name: "Stop api on prod" }).click();
    await expect(page.getByText("No permission to stop or start this instance.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(0);
    await capture(page, "stop-no-permission");
    await expectDesignRules(page);
  });
});

test.describe("stop and start on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("stopped stays inside the instance row", async ({ page }) => {
    app = await serveConsole(
      server({ health: "stopped", error: "upgrade held: drain for maintenance" }),
    );
    await open(page, app);
    const row = instanceRow(page);
    await expect(row).toContainText("stopped");
    await expect(row).toContainText("upgrade held: drain for maintenance");
    await expect(row).not.toContainText("failing");
    await capture(page, "stop-stopped-phone");
    await expectDesignRules(page);
  });
});
