import { expect, test, type Page } from "@playwright/test";
import type { FleetStatusReport } from "../src/api/tenkai.gen";
import {
  expectDesignRules,
  openEnvironment,
  serveConsole,
  type MockBackend,
  type Reply,
  type Routes,
} from "./mock-backend";

const ok = (body: unknown): Reply => ({ status: 200, body });

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

const INSPECT = {
  id: "env:prod",
  name: "prod",
  description: "fixture",
  execution_note: "",
  facts: {},
  lease: { held: false, generation: 0, status: "free" },
  latest_plan: {
    id: "tenkai:plan:1",
    state: "computed",
    created_at: 1,
    step_count: 1,
    digest: "sha256:abc",
    steps: [{ id: "s1", order: 1, product: "api", action: "upgrade", from: "1.0.0", to: "1.1.0" }],
  },
  subscriptions: [
    { product: "api", channel: "stable", head: "1.1.0", deployed: "1.0.0", state: "behind" },
  ],
};

const server = (): Routes => (raw) => {
  const path = decodeURIComponent(raw);
  if (path === "/v1/auth/oidc") {
    return { status: 404, body: { error: "no oidc client" } };
  }
  if (path === "/v1/auth/me") {
    return ok({
      principal: "host:uid:1000",
      kind: "human",
      capabilities: ["read"],
      user: "alice",
      groups: ["tenkai-operator"],
      source: "host",
    });
  }
  if (path === "/v1/fleet/status") {
    return ok(FLEET);
  }
  if (path === "/v1/environments") {
    return ok([{ id: "env:prod", name: "prod", description: "fixture" }]);
  }
  if (path === "/v1/channels") {
    return ok({ items: [{ id: "ch:api:stable", product: "api", name: "stable", head: "1.1.0" }] });
  }
  if (path === "/v1/environments/prod") {
    return ok(INSPECT);
  }
  if (path === "/v1/environments/prod/hold") {
    return ok({ audit: [] });
  }
  if (path === "/v1/environments/prod/dependencies") {
    return ok({ environment: "prod", holds: [], products: [] });
  }
  if (path === "/v1/environments/prod/status") {
    return ok([]);
  }
  if (path === "/v1/environments/prod/runtime") {
    return ok({ environment: "prod", components: [] });
  }
  if (path === "/v1/products/api/owner") {
    return ok({ contact: "platform-team" });
  }
  if (path === "/v1/products/api/webhooks") {
    return ok([]);
  }
  if (path === "/v1/products/api/criticality") {
    return ok({ effective: "high" });
  }
  if (path === "/v1/releases") {
    return ok({ items: [{ id: "rel:api@1.1.0", product: "api", version: "1.1.0", digest: "aa" }] });
  }
  if (path === "/v1/runners") {
    return ok({ runners: [] });
  }
  if (path === "/v1/events") {
    return ok({ events: [], next_cursor: "" });
  }
  return undefined;
};

const signIn = async (page: Page, url: string) => {
  await page.goto(url);
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
};

const shot = (page: Page, name: string) =>
  page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });

const blockStorage = async (page: Page) => {
  await page.addInitScript(() => {
    const boom = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: boom,
        setItem: boom,
        removeItem: boom,
        clear: boom,
        key: boom,
        length: 0,
      },
    });
  });
};

test.describe("pins and recent at desktop width", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("star pins an object into the sidebar and Home, and it survives reload", async ({
    page,
  }) => {
    app = await serveConsole(server());
    await signIn(page, app.url);
    await expect(page.getByText("None yet.")).toHaveCount(2);
    await openEnvironment(page);
    await page.getByRole("button", { name: "Pin" }).click();
    await expect(page.getByRole("button", { name: "Unpin" })).toBeVisible();
    await expectDesignRules(page);
    await shot(page, "env-pinned");
    const main = page.getByRole("navigation", { name: "Main" });
    await expect(main.getByRole("link", { name: "prod" })).toBeVisible();
    await main.getByRole("link", { name: "Home" }).click();
    await expect(page.getByRole("list", { name: "Pinned" })).toContainText("prod");
    await expect(page.getByRole("list", { name: "Pinned" })).toContainText("env");
    await expectDesignRules(page);
    await shot(page, "home-pinned");

    await page.reload();
    await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
    await expect(page.getByRole("list", { name: "Pinned" })).toContainText("prod");
    await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "prod" })
      .click();
    await page.getByRole("button", { name: "Unpin" }).click();
    await expect(page.getByRole("button", { name: "Pin" })).toBeVisible();
    await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Home" })
      .click();
    await expect(page.getByRole("heading", { name: "Pinned" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Pinned" })).toHaveCount(0);
  });

  test("opening objects fills Recent on Home", async ({ page }) => {
    app = await serveConsole(server());
    await signIn(page, app.url);
    await openEnvironment(page);
    await page.getByRole("link", { name: "api", exact: true }).first().click();
    await expect(page.getByRole("heading", { name: "api", exact: true })).toBeVisible();
    await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Home" })
      .click();
    const recent = page.getByRole("list", { name: "Recent" });
    await expect(recent).toContainText("api");
    await expect(recent).toContainText("prod");
    await expectDesignRules(page);
    await shot(page, "home-recent");
  });

  test("blocked storage leaves lists empty and the console works", async ({ page }) => {
    app = await serveConsole(server());
    await blockStorage(page);
    await signIn(page, app.url);
    await expect(page.getByText("None yet.")).toHaveCount(2);
    await openEnvironment(page);
    await page.getByRole("button", { name: "Pin" }).click();
    await expect(page.getByRole("button", { name: "Pin" })).toBeVisible();
    await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Home" })
      .click();
    await expect(page.getByText("None yet.")).toHaveCount(2);
    await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
    await expectDesignRules(page);
    await shot(page, "storage-blocked");
  });
});

test.describe("pins at phone width", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("Apps lists pinned objects and does not overflow", async ({ page }) => {
    app = await serveConsole(server());
    await signIn(page, app.url);
    await openEnvironment(page);
    await page.getByRole("button", { name: "Pin" }).click();
    await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Apps" })
      .click();
    await expect(page.getByRole("heading", { name: "Apps" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Pinned" })).toContainText("prod");
    await expectDesignRules(page);
    await shot(page, "apps-pinned-phone");
  });
});
