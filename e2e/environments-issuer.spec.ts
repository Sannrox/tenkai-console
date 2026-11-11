// Environment identity issuer against a mocked API. Run with `pnpm build && pnpm e2e`.
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

const issuer = (page: import("@playwright/test").Page) =>
  page.locator("table").filter({ has: page.getByRole("columnheader", { name: "Fingerprint" }) });

test.describe("environment identity issuer", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("says the server does not report an issuer when inspect omits it", async ({ page }) => {
    app = await serveConsole(
      server({
        ...BASE,
        subscriptions: [{ product: "api", channel: "stable", head: "1.0.0", state: "current" }],
      } as unknown as EnvironmentInspectReport),
    );
    await page.goto(app.url);
    await page.getByRole("link", { name: "Environments" }).click();
    await expect(page.getByRole("heading", { name: "Identity issuer" })).toBeVisible();
    await expect(page.getByText("This server does not report an identity issuer.")).toBeVisible();
    await expect(issuer(page)).toHaveCount(0);
    await expectDesignRules(page);
  });

  test("says none when there is no issuer", async ({ page }) => {
    app = await serveConsole(
      server({
        ...BASE,
        identity_issuer: {},
        subscriptions: [{ product: "api", channel: "stable", head: "1.0.0", state: "current" }],
      } as unknown as EnvironmentInspectReport),
    );
    await page.goto(app.url);
    await page.getByRole("link", { name: "Environments" }).click();
    await expect(page.getByRole("heading", { name: "Identity issuer" })).toBeVisible();
    const card = page
      .getByRole("heading", { name: "Identity issuer" })
      .locator("xpath=following-sibling::*[1]");
    await expect(card.getByText("none")).toBeVisible();
    await expect(page.getByText("This server does not report an identity issuer.")).toHaveCount(0);
    await expectDesignRules(page);
  });

  test("names waiting instances on a blocked rotation, with no actions", async ({ page }) => {
    app = await serveConsole(
      server({
        ...BASE,
        identity_issuer: {
          current: {
            fingerprint: "ab",
            generation: 1,
            recipients: ["runtime:prod-a"],
          },
          next: { fingerprint: "cd", generation: 2, recipients: [] },
        },
        identity_issuer_waiting: [
          "api (bundle without the next issuer)",
          "web (bundle written too recently)",
        ],
        subscriptions: [{ product: "api", channel: "stable", head: "1.0.0", state: "current" }],
      } as unknown as EnvironmentInspectReport),
    );
    await page.goto(app.url);
    await page.getByRole("link", { name: "Environments" }).click();
    const table = issuer(page);
    await expect(table.getByRole("cell", { name: "current", exact: true })).toBeVisible();
    await expect(table.getByRole("cell", { name: "lost", exact: true })).toBeVisible();
    await expect(page.getByText("blocked")).toBeVisible();
    await expect(page.getByText("api (bundle without the next issuer)")).toBeVisible();
    await expect(page.getByText("web (bundle written too recently)")).toBeVisible();
    await expect(page.getByText("2 waiting")).toHaveCount(0);
    await expect(table.getByRole("button")).toHaveCount(0);
    await expectDesignRules(page);
  });
});

test.describe("environment identity issuer on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("shows the issuer without leaking internals", async ({ page }) => {
    app = await serveConsole(
      server({
        ...BASE,
        identity_issuer: {
          current: { fingerprint: "ab", generation: 1, recipients: ["runtime:prod-a"] },
        },
        subscriptions: [{ product: "api", channel: "stable", head: "1.0.0", state: "current" }],
      } as unknown as EnvironmentInspectReport),
    );
    await page.goto(app.url);
    await page.getByRole("link", { name: "Environments" }).click();
    await expect(page.getByRole("heading", { name: "Identity issuer" })).toBeVisible();
    await expect(issuer(page).getByRole("cell", { name: "ab", exact: true })).toBeVisible();
    expect(await page.locator("body").textContent()).not.toMatch(
      /\bADR\b|#\d+|HTTP \d{3}|\/v1\/|\bat \w+ \(|Error:|—/,
    );
  });
});
