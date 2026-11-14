// Automatic and operator environment holds against a mocked API. Run with `pnpm build && pnpm e2e`.
import { type Page, expect, test } from "@playwright/test";
import type {
  DeliveryHold,
  DeliveryHoldView,
  EnvironmentInspectReport,
  FleetStatusReport,
} from "../src/api/tenkai.gen";
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

const OPERATOR_ME = {
  principal: "host:uid:1000",
  kind: "human",
  capabilities: ["read", "management"],
  user: "alice",
  groups: ["tenkai-operator"],
  source: "host",
};

const THRESHOLD = {
  environment: "prod",
  count: 2,
  window_ms: 3_600_000,
  actor: "alice",
  set_at: 1_700_000_000_000,
};

// The reason format Tenkai writes: count, then each instance and its cause.
const AUTOMATIC: DeliveryHold = {
  actor: "automatic",
  held_at: 1_700_000_600_000,
  reason:
    "automatic: 3 failed target(s); web-1 (health probe failed); web-2 (image pull refused); web-3 (exit 1)",
};

const OPERATOR: DeliveryHold = {
  actor: "alice",
  held_at: 1_700_000_900_000,
  reason: "investigating registry",
};

const ok = (body: unknown): Reply => ({ status: 200, body });

const server = (hold: DeliveryHold | undefined, view: Reply): Routes => {
  const inspect = {
    id: "env:prod",
    name: "prod",
    description: "fixture",
    execution_note: "",
    facts: {},
    lease: { held: true, generation: 4, status: "held" },
    latest_plan: null,
    subscriptions: [{ product: "web", channel: "stable", head: "1.0.0", state: "current" }],
    ...(hold ? { delivery_hold: hold } : {}),
  } as unknown as EnvironmentInspectReport;
  return (path) => {
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
      return view;
    }
    if (path === "/v1/environments/prod/hold/threshold") {
      return ok({ version: 1, operation: "hold_threshold", message: "threshold on prod" });
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

const view = (body: DeliveryHoldView): Reply => ok(body);

/** The detail list row value for a label such as "delivery hold". */
const row = (page: Page, label: string) =>
  page
    .locator("dt", { hasText: new RegExp(`^${label}$`) })
    .locator("xpath=following-sibling::dd[1]");

const threshold = (page: Page) => page.getByLabel("Failure threshold configured");

const open = async (page: Page, app: MockBackend) => {
  await page.goto(app.url);
  const loaded = page.waitForResponse((response) =>
    response.url().endsWith("/v1/environments/prod/hold"),
  );
  await page.getByRole("link", { name: "Environments" }).click();
  await loaded;
  await expect(row(page, "delivery hold")).toBeVisible();
};

test.describe("environment holds", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("no hold and no threshold", async ({ page }) => {
    app = await serveConsole(server(undefined, view({ audit: [] })));
    await open(page, app);
    await expect(row(page, "delivery hold")).toHaveText("none");
    await expect(row(page, "lifts")).toHaveCount(0);
    await expect(page.getByLabel("Hold history")).toHaveCount(0);
    await expect(threshold(page)).toHaveText("none");
    await expectDesignRules(page);
  });

  test("automatic hold names failed instances and lifts itself", async ({ page }) => {
    app = await serveConsole(
      server(
        AUTOMATIC,
        view({
          hold: AUTOMATIC,
          threshold: THRESHOLD,
          audit: [
            { action: "set", actor: "automatic", at: AUTOMATIC.held_at, reason: AUTOMATIC.reason },
          ],
        }),
      ),
    );
    await open(page, app);
    const hold = row(page, "delivery hold");
    await expect(hold).toContainText("held by automatic");
    await expect(hold).toContainText("web-1 (health probe failed)");
    await expect(hold).toContainText("web-3 (exit 1)");
    await expect(row(page, "lifts")).toHaveText("lifts itself at 2 or fewer failed targets in 1h");
    await expect(page.getByLabel("Hold history")).toContainText("set by automatic");
    await expect(threshold(page)).toHaveText(
      "more than 2 failed targets in 1h, set by alice at 2023-11-14T22:13:20.000Z",
    );
    await expectDesignRules(page);
  });

  test("operator hold never lifts itself", async ({ page }) => {
    app = await serveConsole(
      server(
        OPERATOR,
        view({
          hold: OPERATOR,
          threshold: THRESHOLD,
          audit: [{ action: "set", actor: "alice", at: OPERATOR.held_at, reason: OPERATOR.reason }],
        }),
      ),
    );
    await open(page, app);
    await expect(row(page, "delivery hold")).toContainText("held by alice");
    await expect(row(page, "lifts")).toHaveText("never lifts itself");
    await expectDesignRules(page);
  });

  test("operator hold over an automatic one shows both actors", async ({ page }) => {
    app = await serveConsole(
      server(
        OPERATOR,
        view({
          hold: OPERATOR,
          threshold: THRESHOLD,
          audit: [
            { action: "set", actor: "automatic", at: AUTOMATIC.held_at, reason: AUTOMATIC.reason },
            { action: "set", actor: "alice", at: OPERATOR.held_at, reason: OPERATOR.reason },
          ],
        }),
      ),
    );
    await open(page, app);
    await expect(row(page, "lifts")).toHaveText("never lifts itself");
    const history = page.getByLabel("Hold history").getByRole("listitem");
    await expect(history).toHaveCount(2);
    await expect(history.nth(0)).toContainText("set by alice");
    await expect(history.nth(1)).toContainText("set by automatic");
    await expect(history.nth(1)).toContainText("web-2 (image pull refused)");
    await expectDesignRules(page);
  });

  test("automatic hold without a threshold does not lift itself", async ({ page }) => {
    app = await serveConsole(server(AUTOMATIC, view({ hold: AUTOMATIC, audit: [] })));
    await open(page, app);
    await expect(row(page, "lifts")).toHaveText("does not lift itself while no threshold is set");
    await expect(threshold(page)).toHaveText("none");
    await expectDesignRules(page);
  });

  test("hold view unavailable keeps the hold and hides the threshold", async ({ page }) => {
    app = await serveConsole(server(OPERATOR, { status: 500, body: { error: "store busy" } }));
    await open(page, app);
    await expect(row(page, "delivery hold")).toContainText("held by alice");
    await expect(row(page, "hold history")).toHaveText("Could not load");
    await expect(row(page, "lifts")).toHaveCount(0);
    await expect(threshold(page)).toHaveCount(0);
    await expectDesignRules(page);
  });

  test("declares a threshold with the lease generation", async ({ page }) => {
    app = await serveConsole(server(undefined, view({ audit: [] })));
    await open(page, app);
    const section = page
      .getByRole("heading", { name: "Failure threshold" })
      .locator("xpath=ancestor::div[2]");
    await section.getByRole("button", { name: "Edit" }).click();
    await section.getByLabel("Failed targets").fill("2");
    await section.getByLabel("Window, as 1h").fill("1h");
    await section.getByRole("button", { name: "Set", exact: true }).click();
    const sent = page.waitForRequest((request) => request.url().endsWith("/hold/threshold"));
    await section
      .getByRole("button", { name: "Hold prod at more than 2 failed targets in 1h" })
      .click();
    expect((await sent).postDataJSON()).toStrictEqual({
      version: 1,
      operation: "hold_threshold",
      environment: "prod",
      expected_generation: 4,
      count: 2,
      window: "1h",
    });
    await expect(page.getByText("threshold on prod")).toBeVisible();
    expect(app.sent.filter((call) => call.path.endsWith("/hold/threshold"))).toHaveLength(1);
    await expectDesignRules(page);
  });
});

// The environments screen already overflows a phone (top bar tabs, fleet
// table), so overflow is checked on the hold rows and threshold section only.
test.describe("environment holds on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("automatic and operator history fit without leaking internals", async ({ page }) => {
    app = await serveConsole(
      server(
        AUTOMATIC,
        view({
          hold: AUTOMATIC,
          threshold: THRESHOLD,
          audit: [
            { action: "set", actor: "alice", at: OPERATOR.held_at - 1, reason: OPERATOR.reason },
            { action: "clear", actor: "alice", at: OPERATOR.held_at, reason: OPERATOR.reason },
            { action: "set", actor: "automatic", at: AUTOMATIC.held_at, reason: AUTOMATIC.reason },
          ],
        }),
      ),
    );
    await open(page, app);
    await expect(row(page, "lifts")).toBeVisible();
    for (const element of [
      page.locator("dl", { has: page.locator("dt", { hasText: "delivery hold" }) }),
      row(page, "delivery hold"),
      row(page, "hold history"),
      threshold(page),
    ]) {
      const box = await element.evaluate((node) => ({
        overflow: node.scrollWidth - node.clientWidth,
      }));
      expect(box.overflow).toBeLessThanOrEqual(0);
    }
    expect(await page.locator("body").textContent()).not.toMatch(
      /\bADR\b|#\d+|HTTP \d{3}|\/v1\/|\bat \w+ \(|Error:|—/,
    );
  });
});
