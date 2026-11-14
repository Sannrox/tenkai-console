// What blocks an instance's next change, against a mocked API. Run with `pnpm build && pnpm e2e`.
import { type Page, expect, test } from "@playwright/test";
import type {
  FleetEnvironmentRow,
  FleetStatusReport,
  InstanceExplainBlocker,
  InstanceExplainReport,
} from "../src/api/tenkai.gen";
import {
  type MockBackend,
  type Reply,
  type Routes,
  expectDesignRules,
  serveConsole,
} from "./mock-backend";

const HOST_ME = {
  principal: "host:uid:1000",
  kind: "human",
  capabilities: ["read"],
  user: "alice",
  groups: ["tenkai-viewer"],
  source: "host",
};

const ok = (body: unknown): Reply => ({ status: 200, body });

const FLEET_ROW: FleetEnvironmentRow = {
  id: "env:prod",
  name: "prod",
  description: "fixture",
  subscription_count: 2,
  products_current: 1,
  products_behind: 1,
  products_missing: 0,
  unhealthy: false,
  health_summary: "ok",
  lease_held: false,
  posture: "behind",
};

const FLEET: FleetStatusReport = {
  environments: [FLEET_ROW],
  environment_count: 1,
  environments_current: 0,
  environments_behind: 1,
  environments_unhealthy: 0,
  environments_empty: 0,
};

// `api` is behind its channel head; `web` is current.
const SUBSCRIPTIONS = [
  {
    product: "api",
    instance: "api",
    channel: "stable",
    head: "1.1.0",
    deployed: "1.0.0",
    state: "behind",
    health: "healthy",
  },
  {
    product: "web",
    instance: "web",
    channel: "stable",
    head: "1.1.0",
    deployed: "1.1.0",
    state: "current",
    health: "healthy",
  },
];

/** `explain` answers `GET .../instances/api/explain`. */
const server =
  (explain: Reply): Routes =>
  (path) => {
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
      return ok({
        id: "env:prod",
        name: "prod",
        description: "fixture",
        execution_note: "",
        facts: {},
        lease: { held: false, status: "free" },
        latest_plan: null,
        subscriptions: SUBSCRIPTIONS,
      });
    }
    if (path === "/v1/environments/prod/status") {
      return ok(SUBSCRIPTIONS);
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
    if (path === "/v1/environments/prod/instances/api/explain") {
      return explain;
    }
    return undefined;
  };

const report = (
  blockers: InstanceExplainBlocker[],
  next?: InstanceExplainReport["next_change"],
): Reply =>
  ok({
    environment: "prod",
    instance: "api",
    blockers,
    ...(next === undefined ? {} : { next_change: next }),
  } satisfies InstanceExplainReport);

const HOLD: InstanceExplainBlocker = {
  check: "delivery_hold",
  evidence: "environment prod held by alice: change freeze",
  unblock: "tenkaictl env hold prod release",
};
const MAINTENANCE: InstanceExplainBlocker = {
  check: "maintenance",
  evidence: "outside window sat 02:00-04:00 UTC",
  unblock: "wait until 2026-11-21T02:00:00Z",
};
const APPROVAL: InstanceExplainBlocker = {
  check: "approval",
  evidence: "plan tenkai:plan:prod:7 needs 1 more approval",
  unblock: "tenkaictl plan approve tenkai:plan:prod:7",
};
const STALE: InstanceExplainBlocker = {
  check: "superseded_plan",
  evidence: "stored plan tenkai:plan:prod:6 is stale for current state",
  unblock: "tenkaictl env reconcile prod api",
};

const section = (page: Page) => page.getByRole("region", { name: "Next change for api" });

const openExplain = async (page: Page, app: MockBackend) => {
  await page.goto(app.url);
  await page.getByRole("link", { name: "Environments" }).click();
  await page.getByRole("button", { name: "Why is api behind" }).click();
  await expect(section(page)).toBeVisible();
};

const checks = (page: Page) => section(page).getByRole("row").locator("td:first-child");

const capture = (page: Page, name: string) =>
  page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });

test.describe("what blocks an instance's next change", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("only rows behind head offer it, and nothing is read until asked", async ({ page }) => {
    app = await serveConsole(server(report([HOLD])));
    await page.goto(app.url);
    await page.getByRole("link", { name: "Environments" }).click();
    await expect(page.getByRole("button", { name: "Why is api behind" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Why is web behind" })).toHaveCount(0);
    expect(app.sent.some((sent) => sent.path.endsWith("/explain"))).toBe(false);
  });

  test("nothing blocks: names the next change", async ({ page }) => {
    app = await serveConsole(
      server(report([], { action: "upgrade", deployed: "1.0.0", head: "1.1.0" })),
    );
    await openExplain(page, app);
    await expect(section(page)).toContainText("Nothing blocks");
    await expect(section(page)).toContainText("upgrade 1.0.0 -> 1.1.0");
    await expect(section(page).getByRole("table")).toHaveCount(0);
    await capture(page, "explain-clear");
    await expectDesignRules(page);
  });

  test("a single blocker with evidence and unblock action", async ({ page }) => {
    app = await serveConsole(server(report([HOLD])));
    await openExplain(page, app);
    await expect(checks(page)).toHaveText(["delivery_hold"]);
    await expect(section(page)).toContainText(HOLD.evidence);
    await expect(section(page)).toContainText(HOLD.unblock);
    await expect(section(page)).not.toContainText("Nothing blocks");
    await capture(page, "explain-single");
    await expectDesignRules(page);
  });

  test("many blockers render together in server order", async ({ page }) => {
    // Deliberately not admission order: the console must not re-sort.
    app = await serveConsole(server(report([APPROVAL, HOLD, MAINTENANCE])));
    await openExplain(page, app);
    await expect(checks(page)).toHaveText(["approval", "delivery_hold", "maintenance"]);
    await capture(page, "explain-many");
    await expectDesignRules(page);
    expect(app.sent.every((sent) => sent.method === "GET")).toBe(true);
  });

  test("a stale approved plan is flagged for re-planning", async ({ page }) => {
    app = await serveConsole(server(report([HOLD, STALE])));
    await openExplain(page, app);
    const stale = section(page).getByRole("row").filter({ hasText: "superseded_plan" });
    await expect(stale).toContainText("stale, re-plan");
    await expect(stale).toContainText(STALE.evidence);
    await expect(stale.getByRole("link", { name: "Open plan" })).toHaveAttribute(
      "href",
      /environments\/prod\/plan$/,
    );
    await expect(
      section(page).getByRole("row").filter({ hasText: "delivery_hold" }),
    ).not.toContainText("re-plan");
    await capture(page, "explain-stale-plan");
    await expectDesignRules(page);
  });

  test("an older server without the route reads unavailable", async ({ page }) => {
    app = await serveConsole(server({ status: 404, body: { error: "not found" } }));
    await openExplain(page, app);
    await expect(section(page)).toContainText("This server does not explain blockers.");
    await capture(page, "explain-unavailable");
    await expectDesignRules(page);
  });

  test("no permission", async ({ page }) => {
    app = await serveConsole(server({ status: 403, body: { error: "forbidden" } }));
    await openExplain(page, app);
    await expect(section(page)).toContainText("No access");
    await expectDesignRules(page);
  });

  test("close hides it again", async ({ page }) => {
    app = await serveConsole(server(report([HOLD])));
    await openExplain(page, app);
    await section(page).getByRole("button", { name: "Close" }).click();
    await expect(section(page)).toHaveCount(0);
  });
});

test.describe("what blocks an instance's next change on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("blockers stay inside the viewport", async ({ page }) => {
    app = await serveConsole(server(report([APPROVAL, HOLD, MAINTENANCE, STALE])));
    await openExplain(page, app);
    await section(page).scrollIntoViewIfNeeded();
    await capture(page, "explain-phone");
    // The top navigation overflows a phone on every screen today; hold this
    // section to the viewport and the copy rules.
    const box = await section(page).boundingBox();
    expect((box?.x ?? 0) + (box?.width ?? Infinity)).toBeLessThanOrEqual(390);
    expect(await page.locator("body").textContent()).not.toMatch(
      /\bADR\b|#\d+|HTTP \d{3}|\/v1\/|\bat \w+ \(|Error:|—/,
    );
  });
});
