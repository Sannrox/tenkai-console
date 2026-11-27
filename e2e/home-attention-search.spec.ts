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
  serveConsole,
} from "./mock-backend";

const ok = (body: unknown): Reply => ({ status: 200, body });

const FLEET: FleetStatusReport = {
  environments: [
    {
      id: "env:prod",
      name: "prod",
      description: "fixture",
      subscription_count: 2,
      products_current: 0,
      products_behind: 1,
      products_missing: 0,
      unhealthy: true,
      health_summary: "error",
      lease_held: false,
      posture: "unhealthy",
      open_exposures: [
        {
          advisory_id: "TENKAI-2026-1",
          age_ms: 86_400_000,
          first_seen_at: Date.UTC(2026, 10, 20),
          release: "api@1.0.0",
          severity: "high",
        },
      ],
    },
    {
      id: "env:edge",
      name: "edge",
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
  environment_count: 2,
  environments_current: 0,
  environments_behind: 1,
  environments_unhealthy: 1,
  environments_empty: 0,
};

const RUNNERS = {
  runners: [
    {
      id: "sha256:0123456789abcdef0123",
      environment: "prod",
      state: "active",
      instances: [{ holds_lease: false, instance_id: "api-1" }],
    },
  ],
};

const EVENTS = {
  events: [
    {
      cursor: "1",
      kind: "release_recalled" as const,
      occurred_at: Date.UTC(2026, 10, 21, 10),
      resource: "api@1.0.0",
      environment: "prod",
    },
    {
      cursor: "2",
      kind: "target_failed" as const,
      occurred_at: Date.UTC(2026, 10, 21, 11),
      resource: "api-1",
      environment: "prod",
    },
  ],
  next_cursor: "",
};

const FEED = {
  advisory_count: 1,
  age_ms: 1,
  generated_at: 1,
  imported: true,
  imported_at: 1,
  matches: [
    {
      advisory_id: "TENKAI-2026-1",
      component: "openssl",
      component_version: "3.0.0",
      release: "api@1.0.0",
      release_id: "tenkai:release:api@1.0.0",
      severity: "high",
    },
  ],
};

const PLAN = {
  id: "tenkai:plan:1",
  state: "computed",
  created_at: 1,
  step_count: 1,
  digest: "sha256:abc",
  steps: [{ id: "s1", order: 1, product: "api", action: "upgrade", from: "1.0.0", to: "1.1.0" }],
};

const server = (): Routes => (path) => {
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
    return ok([
      { id: "env:prod", name: "prod", description: "fixture" },
      { id: "env:edge", name: "edge", description: "fixture" },
    ]);
  }
  if (path === "/v1/channels") {
    return ok({
      items: [{ id: "ch:api:stable", product: "api", name: "stable", head: "1.1.0" }],
    });
  }
  if (path === "/v1/runners") {
    return ok(RUNNERS);
  }
  if (path === "/v1/events") {
    return ok(EVENTS);
  }
  if (path === "/v1/releases") {
    return ok({ items: [{ id: "rel:api@1.1.0", product: "api", version: "1.1.0", digest: "aa" }] });
  }
  if (path === "/v1/advisory-feed") {
    return ok(FEED);
  }
  if (decodeURIComponent(path) === "/v1/plans/tenkai:plan:1") {
    return ok(PLAN);
  }
  return undefined;
};

const INSPECT = {
  id: "env:prod",
  name: "prod",
  description: "fixture",
  execution_note: "",
  facts: {},
  lease: { held: true, generation: 4, status: "held" },
  latest_plan: PLAN,
  subscriptions: [
    { product: "api", channel: "stable", head: "1.1.0", deployed: "1.0.0", state: "behind" },
  ],
};

const withProd = (): Routes => (path, request) => {
  const decoded = decodeURIComponent(path);
  if (decoded === "/v1/environments/prod") {
    return ok(INSPECT);
  }
  if (decoded === "/v1/environments/prod/hold") {
    return ok({ audit: [] });
  }
  if (decoded === "/v1/environments/prod/dependencies") {
    return ok({ environment: "prod", holds: [], products: [] });
  }
  if (decoded === "/v1/environments/prod/status") {
    return ok([]);
  }
  if (decoded === "/v1/environments/prod/runtime") {
    return ok({ environment: "prod", components: [] });
  }
  if (request.method === "POST" && decoded === "/v1/reconcile") {
    return ok({ environments: [] });
  }
  return server()(path, request);
};

const signIn = async (page: Page, url: string) => {
  await page.goto(url);
  await page.getByLabel("Platform token").fill("fixture-token");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Environments", level: 1 })).toBeVisible();
};

const openAttention = async (page: Page) => {
  const main = page.getByRole("navigation", { name: "Main" });
  const fromRail = main.getByRole("link", { name: "Attention" });
  const more = main.getByRole("link", { name: "More" });
  await fromRail.or(more).waitFor();
  if (await fromRail.isVisible()) {
    await fromRail.click();
  } else {
    await more.click();
    await page.getByRole("link", { name: "Attention" }).click();
  }
  await expect(page.getByRole("heading", { name: "Attention", level: 1 })).toBeVisible();
};

const shot = (page: Page, name: string) =>
  page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });

test.describe("home attention and search at desktop width", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("landing is the Environments table with Reconcile in Actions", async ({ page }) => {
    app = await serveConsole(server());
    await signIn(page, app.url);
    await expect(page.getByRole("heading", { name: "Environments", exact: true })).toBeVisible();
    await expect(page.getByText("2 environments, 1 behind")).toBeVisible();
    const homeActions = await openActions(page);
    await expect(homeActions.getByRole("button", { name: "Reconcile" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reconcile" })).toHaveCount(1);
    await page.getByRole("button", { name: "Actions" }).click();
    await expect(page.getByRole("region", { name: "Environments" })).toBeVisible();
    await expect(page.locator("table tbody tr").first()).toBeVisible();
    await expect(page.getByRole("list", { name: "Attention" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Pinned" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Recent" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add environment" })).toHaveCount(0);
    await expect(
      page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Attention" }),
    ).toBeVisible();
    await expectDesignRules(page);
    await shot(page, "home");
  });

  test("attention lists the fixture rows and the per-environment gap", async ({ page }) => {
    app = await serveConsole(server());
    await signIn(page, app.url);
    await openAttention(page);
    await expect(
      page.getByText("Plan approvals, drift and certificate warnings stay on the environment."),
    ).toBeVisible();
    const list = page.getByRole("list", { name: "Attention" });
    await expect(list).toContainText("prod");
    await expect(list).toContainText("error · unhealthy");
    await expect(list).toContainText("edge");
    await expect(list).toContainText("1 behind");
    await expect(list).toContainText("TENKAI-2026-1");
    await expect(list).toContainText("sha256:0123456789ab");
    await expect(list).toContainText("api@1.0.0");
    await expect(list).toContainText("api-1");
    await expect(list).not.toContainText("awaiting");
    await page.getByRole("button", { name: "Finding" }).click();
    await expect(list).toContainText("TENKAI-2026-1");
    await expect(list).not.toContainText("no heartbeat");
    await expectDesignRules(page);
    await shot(page, "attention");
  });

  test("a failed source says the list may be incomplete and retry reloads it", async ({ page }) => {
    let fail = true;
    app = await serveConsole((path, request) => {
      if (path === "/v1/events") {
        return fail ? { status: 500, body: { error: "events unavailable" } } : ok(EVENTS);
      }
      return server()(path, request);
    });
    await signIn(page, app.url);
    await openAttention(page);
    await expect(page.getByText("list incomplete")).toBeVisible();
    await expect(page.getByText("The list may be incomplete.")).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Attention" })).not.toContainText("Follow through");
    const retry = (await openActions(page)).getByRole("button", { name: "Retry" });
    await expect(retry).toBeVisible();
    fail = false;
    await retry.click();
    await expect(page.getByText("list incomplete")).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Attention" })).toContainText("api@1.0.0");
    await expectDesignRules(page);
    await shot(page, "attention-partial");
  });

  test("search overlay from the rail and Control-K find objects and open a plan by id", async ({
    page,
  }) => {
    app = await serveConsole(server());
    await signIn(page, app.url);
    await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("button", { name: "Search" })
      .click();
    const dialog = page.getByRole("dialog", { name: "Search" });
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("heading", { name: "Search" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Environments", level: 1 })).toBeVisible();
    await dialog.getByRole("textbox", { name: "Search" }).fill("api");
    const results = dialog.getByRole("list", { name: "Results" });
    await expect(results.getByRole("link", { name: /api/ }).first()).toBeVisible();
    await expect(results).toContainText("product");
    await expect(results).toContainText("api@1.1.0");
    await expect(results).toContainText("TENKAI-2026-1");
    await dialog.getByRole("textbox", { name: "Search" }).fill("tenkai:plan:1");
    await results.getByRole("link", { name: /tenkai:plan:1/ }).click();
    await expect(page.getByRole("heading", { name: "api 1.0.0 → 1.1.0" })).toBeVisible();
    await page.keyboard.press("Control+k");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("textbox", { name: "Search" }).fill("prod");
    await expect(dialog.getByRole("list", { name: "Results" })).toContainText("prod");
    await expectDesignRules(page);
    await shot(page, "search");
  });

  test("/search opens the overlay on Environments and /environments redirects home", async ({
    page,
  }) => {
    app = await serveConsole(server());
    await signIn(page, app.url);
    await page.evaluate(() => {
      const base = location.pathname.endsWith("/") ? location.pathname : `${location.pathname}/`;
      history.pushState({}, "", `${base}search`);
      dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect(page.getByRole("dialog", { name: "Search" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Environments", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Search" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      const base = location.pathname.endsWith("/") ? location.pathname : `${location.pathname}/`;
      history.pushState({}, "", `${base}environments`);
      dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect(page.getByRole("heading", { name: "Environments", level: 1 })).toBeVisible();
    expect(new URL(page.url()).pathname.endsWith("/environments")).toBe(false);
    await expectDesignRules(page);
  });

  test("Control-K lists this page's Actions above objects and arms Reconcile in the palette", async ({
    page,
  }) => {
    app = await serveConsole(withProd());
    await signIn(page, app.url);
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "Search" });
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("heading", { name: "Environments", level: 1 })).toBeVisible();
    const actions = dialog.getByRole("list", { name: "Actions" });
    await expect(actions.getByRole("button", { name: "Reconcile" })).toBeVisible();
    await expect(dialog.getByRole("list", { name: "Results" })).toHaveCount(0);
    await expectDesignRules(page);
    await shot(page, "search-commands-page");
    await dialog.getByRole("textbox", { name: "Search" }).fill("re");
    await expect(actions.getByRole("button", { name: "Reconcile" })).toBeVisible();
    await expect(dialog.getByRole("list", { name: "Results" })).not.toContainText("edge");
    await expect(dialog.getByRole("list", { name: "Results" })).not.toContainText("prod");
    await shot(page, "search-commands-page-typed");
    await dialog.getByRole("textbox", { name: "Search" }).fill("prod");
    await expect(dialog.getByRole("button", { name: "Reconcile" })).toHaveCount(0);
    await expect(dialog.getByRole("list", { name: "Results" })).toContainText("prod");
    await dialog.getByRole("textbox", { name: "Search" }).fill("re");
    await expect(actions.getByRole("button", { name: "Reconcile" })).toBeVisible();
    await actions.getByRole("button", { name: "Reconcile" }).click();
    await expect(actions.getByRole("button", { name: "Run one reconcile tick" })).toBeVisible();
    await expect(actions.getByRole("button", { name: "Cancel" })).toBeVisible();
    await shot(page, "search-commands-page-armed");
    await actions.getByRole("button", { name: "Run one reconcile tick" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Environments", level: 1 })).toBeVisible();
    expect(
      app.sent.filter((row) => row.method === "POST" && row.path === "/v1/reconcile"),
    ).toHaveLength(1);
    await expectDesignRules(page);
  });

  test("Control-K on prod lists that object's Actions and Escape leaves the page", async ({
    page,
  }) => {
    app = await serveConsole(withProd());
    await signIn(page, app.url);
    await openEnvironment(page);
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "Search" });
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("heading", { name: "prod", exact: true })).toBeVisible();
    const actions = dialog.getByRole("list", { name: "Actions" });
    await expect(actions.getByRole("link", { name: "Open plan" })).toBeVisible();
    await expect(actions.getByRole("button", { name: "Hold delivery" })).toBeVisible();
    await expect(actions.getByRole("button", { name: "Roll back" })).toBeVisible();
    await expect(actions.getByRole("button", { name: "Retire" })).toBeVisible();
    await expect(actions.getByRole("button", { name: "Reconcile" })).toHaveCount(0);
    await expectDesignRules(page);
    await shot(page, "search-commands-object");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "prod", exact: true })).toBeVisible();
  });

  test("a write missing from Actions is missing from the palette", async ({ page }) => {
    app = await serveConsole(server());
    await signIn(page, app.url);
    await openApp(page, "Releases");
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "Search" });
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("heading", { name: "Releases", exact: true })).toBeVisible();
    await expect(dialog.getByRole("list", { name: "Actions" })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Reconcile" })).toHaveCount(0);
    await expectDesignRules(page);
  });
});

test.describe("attention at phone width", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("phone attention list does not overflow", async ({ page }) => {
    app = await serveConsole(server());
    await signIn(page, app.url);
    await openAttention(page);
    await expectDesignRules(page);
    await shot(page, "phone-attention");
  });

  test("phone Search opens the palette with this page's Actions", async ({ page }) => {
    app = await serveConsole(server());
    await signIn(page, app.url);
    await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("button", { name: "Search" })
      .click();
    const dialog = page.getByRole("dialog", { name: "Search" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Reconcile" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Environments", level: 1 })).toBeVisible();
    await expectDesignRules(page);
    await shot(page, "search-phone");
  });
});
