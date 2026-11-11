// Environment spec-drift against a mocked API. Run with `pnpm build && pnpm e2e`.
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

const server = (inspect: EnvironmentInspectReport): Routes => {
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
      return ok(inspect);
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
    return undefined;
  };
};

const drift = (page: import("@playwright/test").Page) =>
  page.locator("table").filter({ has: page.getByRole("columnheader", { name: "Differs" }) });

test.describe("environment drift", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("says the server does not report drift when inspect omits it", async ({ page }) => {
    app = await serveConsole(
      server({
        ...BASE,
        subscriptions: [{ product: "api", channel: "stable", head: "1.0.0", state: "current" }],
      } as unknown as EnvironmentInspectReport),
    );
    await page.goto(app.url);
    await page.getByRole("link", { name: "Environments" }).click();
    await expect(page.getByRole("heading", { name: "Drift" })).toBeVisible();
    await expect(page.getByText("This server does not report drift.")).toBeVisible();
    await expect(drift(page)).toHaveCount(0);
    await expectDesignRules(page);
  });

  test("says none when every instance is current", async ({ page }) => {
    app = await serveConsole(
      server({
        ...BASE,
        subscriptions: [
          {
            product: "api",
            channel: "stable",
            head: "1.0.0",
            deployed: "1.0.0",
            state: "current",
            spec_drift: { status: "current", objects: [] },
          },
        ],
      } as unknown as EnvironmentInspectReport),
    );
    await page.goto(app.url);
    await page.getByRole("link", { name: "Environments" }).click();
    await expect(page.getByRole("heading", { name: "Drift" })).toBeVisible();
    await expect(page.getByText("This server does not report drift.")).toHaveCount(0);
    const card = page
      .getByRole("heading", { name: "Drift" })
      .locator("xpath=following-sibling::*[1]");
    await expect(card.getByText("none")).toBeVisible();
    await expectDesignRules(page);
  });

  test("shows drifted objects on a held release with no actions", async ({ page }) => {
    app = await serveConsole(
      server({
        ...BASE,
        subscriptions: [
          {
            product: "api",
            instance: "api",
            channel: "stable",
            head: "1.2.0",
            deployed: "1.1.0",
            state: "current",
            delivery_hold: { actor: "alice", held_at: 1_700_000_000_000, reason: "soak" },
            spec_drift: {
              status: "modified outside Tenkai",
              objects: [
                {
                  kind: "Deployment",
                  name: "api",
                  status: "modified outside Tenkai",
                  fields: ["containers", "images"],
                },
              ],
            },
          },
        ],
      } as unknown as EnvironmentInspectReport),
    );
    await page.goto(app.url);
    await page.getByRole("link", { name: "Environments" }).click();
    const table = drift(page);
    await expect(table.getByRole("cell", { name: "Deployment/api", exact: true })).toBeVisible();
    await expect(
      table.getByRole("cell", { name: "containers, images", exact: true }),
    ).toBeVisible();
    await expect(table.getByRole("cell", { name: "drifted", exact: true })).toBeVisible();
    await expect(table.getByRole("cell", { name: "held", exact: true })).toBeVisible();
    await expect(table.getByRole("cell", { name: "1.1.0", exact: true })).toBeVisible();
    await expect(table.getByRole("button")).toHaveCount(0);
    await expectDesignRules(page);
  });
});

test.describe("environment drift on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("shows drift without leaking internals", async ({ page }) => {
    app = await serveConsole(
      server({
        ...BASE,
        subscriptions: [
          {
            product: "api",
            channel: "stable",
            head: "1.1.0",
            state: "current",
            spec_drift: {
              status: "modified outside Tenkai",
              objects: [
                {
                  kind: "Deployment",
                  name: "api",
                  status: "modified outside Tenkai",
                  fields: ["containers"],
                },
              ],
            },
          },
        ],
      } as unknown as EnvironmentInspectReport),
    );
    await page.goto(app.url);
    await page.getByRole("link", { name: "Environments" }).click();
    await expect(page.getByRole("heading", { name: "Drift" })).toBeVisible();
    await expect(drift(page).getByRole("cell", { name: "drifted", exact: true })).toBeVisible();
    expect(await page.locator("body").textContent()).not.toMatch(
      /\bADR\b|#\d+|HTTP \d{3}|\/v1\/|\bat \w+ \(|Error:|—/,
    );
  });
});
