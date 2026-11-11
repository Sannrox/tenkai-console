// Instance identity against a mocked API. Run with `pnpm build && pnpm e2e`.
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

const BASE = {
  id: "env:prod",
  name: "prod",
  description: "fixture",
  execution_note: "",
  facts: {},
  lease: { held: false, status: "free" },
  latest_plan: null,
  subscriptions: [{ product: "api", channel: "stable", head: "1.0.0", state: "current" }],
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

const server = (status: Reply): Routes => {
  return (path) => {
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
      return ok(BASE as unknown as EnvironmentInspectReport);
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
      return status;
    }
    return undefined;
  };
};

const identity = (page: import("@playwright/test").Page) =>
  page.locator("table").filter({ has: page.getByRole("columnheader", { name: "Expires" }) });

const instanceIdentity = (page: import("@playwright/test").Page) =>
  page
    .locator("table")
    .filter({ has: page.getByRole("columnheader", { name: "Deployed" }) })
    .getByRole("cell", { name: "near expiry", exact: true });

test.describe("environment instance identity", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("says the server does not report identity when the route is missing", async ({ page }) => {
    app = await serveConsole(server({ status: 404, body: { error: "not found" } }));
    await page.goto(app.url);
    await page.getByRole("link", { name: "Environments" }).click();
    await expect(page.getByRole("heading", { name: "Identity", exact: true })).toBeVisible();
    await expect(page.getByText("This server does not report instance identity.")).toBeVisible();
    await expect(identity(page)).toHaveCount(0);
    await expectDesignRules(page);
  });

  test("says none when no instance has a certificate", async ({ page }) => {
    app = await serveConsole(server(ok([{ product: "api", channel: "stable", head: "1.0.0" }])));
    await page.goto(app.url);
    await page.getByRole("link", { name: "Environments" }).click();
    await expect(page.getByRole("heading", { name: "Identity", exact: true })).toBeVisible();
    const card = page
      .getByRole("heading", { name: "Identity", exact: true })
      .locator("xpath=following-sibling::*[1]");
    await expect(card.getByText("none")).toBeVisible();
    await expect(identity(page)).toHaveCount(0);
    await expectDesignRules(page);
  });

  test("shows near expiry on the instance list, with no actions", async ({ page }) => {
    const expires = Math.floor(Date.now() / 1000) + 3600;
    app = await serveConsole(
      server(
        ok([
          {
            product: "api",
            channel: "stable",
            head: "1.0.0",
            certificate: { expires_at: expires, near_expiry: true },
          },
        ]),
      ),
    );
    await page.goto(app.url);
    await page.getByRole("link", { name: "Environments" }).click();
    await expect(instanceIdentity(page)).toBeVisible();
    const table = identity(page);
    await expect(table.getByRole("cell", { name: "tenkai://prod/api", exact: true })).toBeVisible();
    await expect(table.getByRole("cell", { name: "near expiry", exact: true })).toBeVisible();
    await expect(
      table.getByRole("cell", { name: new Date(expires * 1000).toISOString() }),
    ).toBeVisible();
    await expect(page.getByText("plan step")).toHaveCount(0);
    await expect(table.getByRole("button")).toHaveCount(0);
    await expectDesignRules(page);
  });
});

test.describe("environment instance identity on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("shows identity without leaking internals", async ({ page }) => {
    const expires = Math.floor(Date.now() / 1000) + 3600;
    app = await serveConsole(
      server(
        ok([
          {
            product: "api",
            channel: "stable",
            head: "1.0.0",
            certificate: {
              expires_at: expires,
              near_expiry: false,
              renewal_failure: "runtime unreachable",
            },
          },
        ]),
      ),
    );
    await page.goto(app.url);
    await page.getByRole("link", { name: "Environments" }).click();
    await expect(page.getByRole("heading", { name: "Identity", exact: true })).toBeVisible();
    await expect(identity(page).getByRole("cell", { name: "renewing", exact: true })).toBeVisible();
    expect(await page.locator("body").textContent()).not.toMatch(
      /\bADR\b|#\d+|HTTP \d{3}|\/v1\/|\bat \w+ \(|Error:|—/,
    );
  });
});
