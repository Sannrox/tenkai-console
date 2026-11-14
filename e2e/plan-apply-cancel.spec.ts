// Cancel a running apply against a mocked API. Run with `pnpm build && pnpm e2e`.
import { type Page, expect, test } from "@playwright/test";
import type { EnvironmentInspectReport, FleetStatusReport } from "../src/api/tenkai.gen";
import { type MockBackend, type Reply, expectDesignRules, serveConsole } from "./mock-backend";

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
      lease_held: true,
      posture: "behind",
    },
  ],
  environment_count: 1,
  environments_current: 0,
  environments_behind: 1,
  environments_unhealthy: 0,
  environments_empty: 0,
};

const HELD = { held: true, status: "active", generation: 7, owner: "controller-a" };
const FREE = { held: false, status: "absent" };

const inspect = (lease: object) =>
  ({
    id: "env:prod",
    name: "prod",
    description: "fixture",
    execution_note: "",
    facts: {},
    lease,
    latest_plan: {
      id: "tenkai:plan:1",
      state: lease === FREE ? "failed" : "running",
      created_at: 1,
      step_count: 1,
      digest: "sha256:abc",
      steps: [
        {
          id: "s1",
          order: 1,
          product: "api",
          action: "upgrade",
          release_id: "rel:1",
          from: "1.0.0",
          to: "1.1.0",
          instance: "api",
        },
      ],
    },
    subscriptions: [
      {
        product: "api",
        instance: "api",
        channel: "stable",
        head: "1.1.0",
        deployed: "1.0.0",
        state: "behind",
      },
    ],
  }) as unknown as EnvironmentInspectReport;

const HOST_ME = {
  principal: "host:uid:1000",
  kind: "human",
  capabilities: ["read", "management"],
  user: "alice",
  groups: ["tenkai-operator"],
  source: "host",
};

const ok = (body: unknown): Reply => ({ status: 200, body });

/** Mock state one test owns: the lease the inspect reports and the cancel answer. */
type World = { lease: object; cancel: Reply; leaseAfterCancel?: object };

const serve = (world: World) =>
  serveConsole((rawPath, request) => {
    const path = decodeURIComponent(rawPath);
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
      return ok(inspect(world.lease));
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
    if (path === "/v1/environments/prod/approval-policy") {
      return ok({ configured: true, mode: "human" });
    }
    if (path === "/v1/environments/prod/apply/cancel" && request.method === "POST") {
      if (world.leaseAfterCancel !== undefined) {
        world.lease = world.leaseAfterCancel;
      }
      return world.cancel;
    }
    return undefined;
  });

const openPlan = async (page: Page, app: MockBackend) => {
  await page.goto(app.url);
  await page.getByRole("link", { name: "Environments" }).click();
  await page.getByRole("link", { name: "Open plan" }).first().click();
};

const section = (page: Page) => page.getByRole("region", { name: "Running apply" });

const confirmCancel = async (page: Page) => {
  await section(page).getByRole("button", { name: "Cancel apply" }).click();
  await section(page).getByRole("button", { name: "Cancel generation 7 on prod" }).click();
};

const cancelPosts = (app: MockBackend) =>
  app.sent.filter((sent) => sent.method === "POST" && sent.path.endsWith("/apply/cancel"));

test.describe("plan apply cancel", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("cancels the running generation, then shows it ended", async ({ page }) => {
    await page.clock.install();
    const world: World = {
      lease: HELD,
      cancel: ok({
        version: 1,
        operation: "cancel",
        message: "asked apply generation 7 to stop after the current step and held prod",
      }),
    };
    app = await serve(world);
    await openPlan(page, app);
    await expect(section(page)).toContainText("Generation 7 is applying");
    await expect(section(page)).toContainText("current step finish first");
    await expectDesignRules(page);

    await section(page).getByLabel("Cancel reason").fill("bad canary");
    const sent = page.waitForRequest((request) => request.url().endsWith("/apply/cancel"));
    await confirmCancel(page);
    expect((await sent).postDataJSON()).toEqual({
      version: 1,
      operation: "cancel",
      environment: "prod",
      expected_generation: 7,
      reason: "bad canary",
    });
    await expect(section(page)).toContainText("Cancelling generation 7");
    await expect(section(page).getByRole("button", { name: "Cancel apply" })).toHaveCount(0);
    await expectDesignRules(page);

    // The apply stops: the next inspect refresh finds the lease free.
    await page.waitForLoadState("networkidle");
    world.lease = FREE;
    await page.clock.runFor(2500);
    await expect(section(page)).toContainText("Generation 7 ended.");
    await expect(page.getByRole("button", { name: "Cancel apply" })).toHaveCount(0);
    expect(cancelPosts(app)).toHaveLength(1);
  });

  test("offers no cancel when the apply already ended", async ({ page }) => {
    app = await serve({ lease: FREE, cancel: ok({}) });
    await openPlan(page, app);
    await expect(page.getByRole("heading", { name: "Steps" })).toBeVisible();
    await expect(section(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Cancel apply" })).toHaveCount(0);
  });

  test("shows the refusal when the apply ended before the cancel arrived", async ({ page }) => {
    app = await serve({
      lease: HELD,
      cancel: { status: 409, body: { error: "environment prod has no apply in progress" } },
      leaseAfterCancel: FREE,
    });
    await openPlan(page, app);
    await confirmCancel(page);
    await expect(section(page).getByRole("alert")).toHaveText(
      "environment prod has no apply in progress",
    );
    await expect(section(page)).toContainText("Generation 7 ended.");
    await expect(page.getByRole("button", { name: "Cancel apply" })).toHaveCount(0);
    await expectDesignRules(page);
  });

  test("hides cancel after a permission refusal", async ({ page }) => {
    app = await serve({
      lease: HELD,
      cancel: { status: 403, body: { error: "insufficient delivery capability" } },
    });
    await openPlan(page, app);
    await confirmCancel(page);
    await expect(section(page)).toContainText("No permission to cancel this apply.");
    await expect(section(page).getByRole("alert")).toHaveText("missing management capability");
    await expect(page.getByRole("button", { name: "Cancel apply" })).toHaveCount(0);
    await expectDesignRules(page);
  });

  test("reads a lost answer as unknown and does not retry", async ({ page }) => {
    app = await serve({ lease: HELD, cancel: ok({}) });
    await page.route("**/apply/cancel", (route) => route.abort("connectionreset"));
    await openPlan(page, app);
    let posts = 0;
    page.on("request", (request) => {
      if (request.url().endsWith("/apply/cancel")) {
        posts += 1;
      }
    });
    await confirmCancel(page);
    await expect(section(page).getByRole("status")).toHaveText(
      "No answer from the server; the outcome is unknown until the next inspect.",
    );
    await page.waitForLoadState("networkidle");
    expect(posts).toBe(1);
    await expect(section(page).getByRole("button", { name: "Cancel apply" })).toBeVisible();
  });
});

test.describe("plan apply cancel on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("fits the running apply section", async ({ page }) => {
    app = await serve({ lease: HELD, cancel: ok({}) });
    await openPlan(page, app);
    const running = section(page);
    await expect(running.getByRole("button", { name: "Cancel apply" })).toBeVisible();
    const overflow = await running.evaluate((node) => node.scrollWidth - node.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const box = await running.boundingBox();
    expect(box && box.x + box.width).toBeLessThanOrEqual(390);
    expect(await running.textContent()).not.toMatch(/\bADR\b|#\d+|HTTP \d{3}|\/v1\/|Error:|—/);
  });
});
