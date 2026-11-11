// Overlay schema checks against a mocked API. Run with `pnpm build && pnpm e2e`.
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
      subscription_count: 1,
      products_current: 0,
      products_behind: 1,
      products_missing: 0,
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

const INVALID = {
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
      head: "2.0.0",
      deployed: "1.0.0",
      state: "behind",
    },
  ],
  config: [
    {
      product: "api",
      overlay: { region: "eu" },
      secrets: ["db-password"],
    },
  ],
} as unknown as EnvironmentInspectReport;

const FIXED = {
  ...INVALID,
  config: [
    {
      product: "api",
      overlay: { region: "eu", replicas: "2" },
      secrets: ["db-password"],
    },
  ],
} as unknown as EnvironmentInspectReport;

const HOST_ME = {
  principal: "host:uid:1000",
  kind: "human",
  capabilities: ["read", "management"],
  user: "alice",
  groups: ["tenkai-operator"],
  source: "host",
};

const ok = (body: unknown): Reply => ({ status: 200, body });

const server = (inspect: () => EnvironmentInspectReport, plan: () => Reply): Routes => {
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
      return ok(inspect());
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
    if (path === "/v1/environments/prod/plans") {
      return request.method === "POST" ? plan() : undefined;
    }
    return undefined;
  };
};

const overlays = (page: import("@playwright/test").Page) =>
  page.locator("table").filter({ has: page.getByRole("columnheader", { name: "Schema" }) });

test.describe("config schema checks", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("shows overlay keys as checked and secret names only", async ({ page }) => {
    app = await serveConsole(
      server(
        () => FIXED,
        () => ok({ version: 1, operation: "plan", message: "planned" }),
      ),
    );
    await page.goto(app.url);
    await page.getByRole("link", { name: "Environments" }).click();
    const table = overlays(page);
    await expect(table.getByRole("cell", { name: "region", exact: true })).toBeVisible();
    await expect(table.getByRole("cell", { name: "eu", exact: true })).toBeVisible();
    await expect(table.getByRole("cell", { name: "checked" }).first()).toBeVisible();
    await expect(table.getByRole("cell", { name: "db-password", exact: true })).toBeVisible();
    await expect(table.getByRole("cell", { name: "declared", exact: true })).toBeVisible();
    await expect(page.getByText("s3cret")).toHaveCount(0);
    await expectDesignRules(page);
  });

  test("shows a required overlay refusal then clears it after a passing plan", async ({ page }) => {
    let inspect = INVALID;
    let planned = false;
    app = await serveConsole(
      server(
        () => inspect,
        () => {
          if (planned) {
            inspect = FIXED;
            return ok({ version: 1, operation: "plan", message: "planned" });
          }
          return {
            status: 409,
            body: { error: "overlay replicas is required by the release config schema" },
          };
        },
      ),
    );
    await page.goto(app.url);
    await page.getByRole("link", { name: "Environments" }).click();
    await page.getByRole("link", { name: "Open plan" }).click();
    await page.getByRole("button", { name: "Plan" }).click();
    const table = overlays(page);
    await expect(table.getByRole("cell", { name: "replicas", exact: true })).toBeVisible();
    await expect(table.getByRole("alert")).toHaveText("required");
    await expect(table.getByRole("cell", { name: "2.0.0" }).first()).toBeVisible();
    await expect(page.getByText("release config schema")).toHaveCount(0);
    await expectDesignRules(page);
    inspect = FIXED;
    planned = true;
    await page.getByRole("button", { name: "Plan" }).click();
    await expect(table.getByRole("cell", { name: "replicas", exact: true })).toBeVisible();
    await expect(table.getByRole("cell", { name: "2", exact: true })).toBeVisible();
    await expect(table.getByRole("cell", { name: "checked" }).first()).toBeVisible();
    await expect(table.getByRole("alert")).toHaveCount(0);
    await expectDesignRules(page);
  });
});

test.describe("config schema checks on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("shows overlays without leaking internals", async ({ page }) => {
    app = await serveConsole(
      server(
        () => FIXED,
        () => ok({ version: 1, operation: "plan", message: "planned" }),
      ),
    );
    await page.goto(app.url);
    await page.getByRole("link", { name: "Environments" }).click();
    await expect(page.getByRole("heading", { name: "Overlays" })).toBeVisible();
    await expect(overlays(page).getByRole("cell", { name: "region", exact: true })).toBeVisible();
    expect(await page.locator("body").textContent()).not.toMatch(
      /\bADR\b|#\d+|HTTP \d{3}|\/v1\/|\bat \w+ \(|Error:|—/,
    );
  });
});
