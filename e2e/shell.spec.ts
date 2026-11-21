import { expect, test, type Page } from "@playwright/test";
import type { FleetStatusReport } from "../src/api/tenkai.gen";
import { expectDesignRules, serveConsole, type MockBackend, type Reply } from "./mock-backend";

const FLEET: FleetStatusReport = {
  environments: [
    {
      id: "env:staging",
      name: "staging",
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

const ok = (body: unknown): Reply => ({ status: 200, body });
const routes = (path: string) => {
  if (path === "/v1/auth/oidc") {
    return { status: 404, body: { error: "no oidc client" } };
  }
  if (path === "/v1/auth/me") {
    return ok({ principal: "management", kind: "management", capabilities: ["read"] });
  }
  if (path === "/v1/fleet/status") {
    return ok(FLEET);
  }
  if (path === "/v1/environments") {
    return ok([]);
  }
  if (path === "/v1/channels") {
    return ok({ items: [] });
  }
  return undefined;
};

const signIn = async (page: Page, url: string) => {
  await page.goto(url);
  await page.getByLabel("Platform token").fill("fixture-token");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
};

const capture = (page: Page, name: string) =>
  page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });

test.describe("shell at desktop width", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("sidebar replaces top tabs and keeps every current path", async ({ page }) => {
    app = await serveConsole(routes);
    await signIn(page, app.url);
    const main = page.getByRole("navigation", { name: "Main" });
    await expect(main.getByRole("link", { name: "Home" })).toBeVisible();
    await expect(main.getByRole("link", { name: "Search" })).toBeVisible();
    await expect(main.getByRole("link", { name: "Attention" })).toBeVisible();
    await expect(main.getByRole("link", { name: "Environments" })).toBeVisible();
    await expect(main.getByRole("link", { name: "Releases" })).toBeVisible();
    await expect(main.getByRole("link", { name: "Exposure" })).toBeVisible();
    await expect(main.getByRole("link", { name: "Runners" })).toBeVisible();
    await expect(main.getByRole("link", { name: "Platform" })).toBeVisible();
    await expect(main.getByRole("link", { name: "Delivery" })).toHaveCount(0);
    await expect(main.getByRole("link", { name: "Access" })).toHaveCount(0);
    await expectDesignRules(page);
    await capture(page, "home-desktop");

    const open = async (id: string, heading: string, click: () => Promise<void>) => {
      await click();
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      await expectDesignRules(page);
      await capture(page, `${id}-desktop`);
    };
    await open("environments", "Environments", () =>
      main.getByRole("link", { name: "Environments" }).click(),
    );
    await open("releases", "Releases", () => main.getByRole("link", { name: "Releases" }).click());
    await open("exposure", "Exposure", () => main.getByRole("link", { name: "Exposure" }).click());
    await open("runners", "Runners", () => main.getByRole("link", { name: "Runners" }).click());
    await open("server", "Server", () => main.getByRole("link", { name: "Platform" }).click());
    const platform = page.getByRole("navigation", { name: "Platform" });
    await expect(platform.getByRole("link", { name: "Server" })).toBeVisible();
    await expect(platform.getByRole("link", { name: "Trust" })).toBeVisible();
    await expect(platform.getByRole("link", { name: "Imports" })).toBeVisible();
    await expect(platform.getByRole("link", { name: "Operations" })).toBeVisible();
    await expect(platform.getByRole("link", { name: "Access" })).toBeVisible();
    await open("trust", "Trust", () => platform.getByRole("link", { name: "Trust" }).click());
    await open("imports", "Imports", () => platform.getByRole("link", { name: "Imports" }).click());
    await open("operations", "Operations", () =>
      platform.getByRole("link", { name: "Operations" }).click(),
    );
    await open("access", "Access", () => platform.getByRole("link", { name: "Access" }).click());
    await expect(page.locator("dl")).toContainText("bearer token");
    await open("search", "Search", () => main.getByRole("link", { name: "Search" }).click());
    await open("attention", "Attention", () =>
      main.getByRole("link", { name: "Attention" }).click(),
    );
    await open("home", "Home", () => main.getByRole("link", { name: "Home" }).click());
  });

  test("collapsed sidebar is icons only and remembered", async ({ page }) => {
    app = await serveConsole(routes);
    await signIn(page, app.url);
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect(
      page.getByRole("navigation", { name: "Main" }).getByText("Environments"),
    ).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Environments" })).toBeVisible();
    await page.reload();
    await page.getByLabel("Platform token").fill("fixture-token");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Main" }).getByText("Environments"),
    ).toHaveCount(0);
    await expectDesignRules(page);
    await capture(page, "collapsed-desktop");
  });
});

test.describe("shell at phone width", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("bottom bar is Home, Attention, Search, Apps and does not overflow", async ({ page }) => {
    app = await serveConsole(routes);
    await signIn(page, app.url);
    const bar = page.getByRole("navigation", { name: "Main" });
    await expect(bar.getByRole("link", { name: "Home" })).toBeVisible();
    await expect(bar.getByRole("link", { name: "Attention" })).toBeVisible();
    await expect(bar.getByRole("link", { name: "Search" })).toBeVisible();
    await expect(bar.getByRole("link", { name: "Apps" })).toBeVisible();
    await expect(bar.getByRole("link", { name: "Environments" })).toHaveCount(0);
    await expectDesignRules(page);
    await capture(page, "home-phone");

    await bar.getByRole("link", { name: "Apps" }).click();
    await expect(page.getByRole("heading", { name: "Apps" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Environments" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Platform" })).toBeVisible();
    await expectDesignRules(page);
    await capture(page, "apps-phone");

    await page.getByRole("link", { name: "Environments" }).click();
    await expect(page.getByRole("heading", { name: "Environments" })).toBeVisible();
    await expectDesignRules(page);
    await capture(page, "environments-phone");

    await page.getByRole("link", { name: "Apps" }).click();
    await page.getByRole("link", { name: "Platform" }).click();
    await expect(page.getByRole("heading", { name: "Server" })).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Platform" }).getByRole("link", { name: "Access" }),
    ).toBeVisible();
    await expectDesignRules(page);
    await capture(page, "platform-phone");
  });
});
