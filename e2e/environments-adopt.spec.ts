// Unmanaged workloads and recording-only adoption, against a mocked API.
// Run with `pnpm build && pnpm e2e`.
import { type Page, expect, test } from "@playwright/test";
import type {
  EnvironmentPlanSummary,
  FleetEnvironmentRow,
  FleetStatusReport,
} from "../src/api/tenkai.gen";
import {
  type MockBackend,
  type Reply,
  type Routes,
  expectDesignRules,
  openEnvironment,
  openEnvironmentTab,
  serveConsole,
} from "./mock-backend";

const ok = (body: unknown): Reply => ({ status: 200, body });

const VIEWER = {
  principal: "host:uid:1000",
  kind: "human",
  capabilities: ["read"],
  user: "alice",
  groups: ["tenkai-viewer"],
  source: "host",
};

const MANAGER = {
  ...VIEWER,
  capabilities: ["read", "management"],
  groups: ["tenkai-operator"],
};

const FLEET_ROW: FleetEnvironmentRow = {
  id: "env:prod",
  name: "prod",
  description: "fixture",
  subscription_count: 2,
  products_current: 1,
  products_behind: 0,
  products_missing: 1,
  unhealthy: false,
  health_summary: "ok",
  lease_held: false,
  posture: "current",
};

const FLEET: FleetStatusReport = {
  environments: [FLEET_ROW],
  environment_count: 1,
  environments_current: 1,
  environments_behind: 0,
  environments_unhealthy: 0,
  environments_empty: 0,
};

const WEB = {
  product: "web",
  instance: "web",
  channel: "stable",
  head: "2.0.0",
  deployed: "2.0.0",
  state: "current",
  health: "healthy",
};

const API = {
  product: "api",
  instance: "api",
  channel: "stable",
  head: "1.0.0",
  deployed: null,
  state: "missing",
};

const UNMANAGED = { kind: "helm", name: "api" };

const adoptPlan = (state: string): EnvironmentPlanSummary => ({
  id: "tenkai:plan:1",
  state,
  created_at: 1,
  step_count: 1,
  digest: "sha256:abc",
  steps: [
    {
      id: "s1",
      order: 1,
      product: "api",
      action: "adopt",
      release_id: "api@1.0.0",
      to: "1.0.0",
    },
  ],
});

const server = (opts: {
  capabilities?: string[];
  unmanaged?: boolean;
  plan?: EnvironmentPlanSummary | null;
  adopt?: Reply;
}): Routes => {
  const me = { ...VIEWER, capabilities: opts.capabilities ?? MANAGER.capabilities };
  const unmanaged = opts.unmanaged ?? true;
  const latest_plan = opts.plan === undefined ? null : opts.plan;
  const subscriptions = unmanaged ? [WEB, API] : [WEB];
  const status = unmanaged ? [WEB, { ...API, unmanaged: UNMANAGED }] : [WEB];
  return (path, request) => {
    if (path === "/v1/auth/oidc") {
      return { status: 404, body: { error: "no oidc client" } };
    }
    if (path === "/v1/auth/me") {
      return ok(me);
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
        latest_plan,
        subscriptions,
      });
    }
    if (path === "/v1/environments/prod/status") {
      return ok(status);
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
    if (path === "/v1/environments/prod/adopt" && request.method === "POST") {
      return (
        opts.adopt ??
        ok({
          version: 1,
          operation: "adopt",
          environment: "prod",
          message: "adopt plan tenkai:plan:1 requires signed approval",
          resource: "tenkai:plan:1",
        })
      );
    }
    return undefined;
  };
};

const section = (page: Page) => page.getByRole("region", { name: "Unmanaged" });
const adopt = (page: Page) => page.getByRole("button", { name: "Adopt", exact: true });
const managed = (page: Page) =>
  page.locator("table").filter({ has: page.getByRole("columnheader", { name: "Deployed" }) });

const open = async (page: Page, app: MockBackend) => {
  await page.goto(app.url);
  await openEnvironment(page);
  await openEnvironmentTab(page, "Instances");
};

const shot = (page: Page, name: string) =>
  page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });

test.describe("unmanaged workloads and adoption", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("no candidates hides the unmanaged section", async ({ page }) => {
    app = await serveConsole(server({ unmanaged: false }));
    await open(page, app);
    await expect(managed(page).getByRole("row").nth(1)).toContainText("web");
    await expect(section(page)).toHaveCount(0);
    await shot(page, "adopt-no-candidates");
    await expectDesignRules(page);
  });

  test("matching: lists unmanaged apart from health and records a pin", async ({ page }) => {
    app = await serveConsole(server({}));
    const bodies: unknown[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/adopt")) {
        bodies.push(request.postDataJSON());
      }
    });
    await page.goto(app.url);
    await openEnvironment(page);
    await expect(
      page.locator("dt", { hasText: /^health$/ }).locator("xpath=following-sibling::dd[1]"),
    ).toHaveText("1 healthy");
    await openEnvironmentTab(page, "Instances");
    await expect(section(page)).toBeVisible();
    await expect(section(page).getByRole("row").nth(1)).toHaveText(/helm.*api/);
    await expect(managed(page).getByRole("row").nth(1)).toContainText("web");
    await expect(managed(page)).not.toContainText("helm");
    await expect(
      section(page).getByText(
        "Adoption records the matching workload as deployed. It does not change the target.",
      ),
    ).toBeVisible();
    await section(page).getByRole("textbox", { name: "Release" }).fill("api@1.0.0");
    await adopt(page).click();
    await page
      .getByRole("button", { name: "Record api@1.0.0 on prod without changing the target" })
      .click();
    await expect(section(page).getByRole("status")).toHaveText(
      "Adoption recorded; the plan needs signed approval.",
    );
    await expect(adopt(page)).toHaveCount(0);
    expect(bodies).toEqual([
      {
        version: 1,
        operation: "adopt",
        environment: "prod",
        expected_generation: 0,
        release: "api@1.0.0",
      },
    ]);
    await shot(page, "adopt-matching");
    await expectDesignRules(page);
  });

  test("differences: lists changed fields and hides Adopt", async ({ page }) => {
    app = await serveConsole(
      server({
        adopt: {
          status: 409,
          body: {
            error:
              "adopt refused: live differs from api@1.0.0 (Service/api ports, Deployment/api image)",
          },
        },
      }),
    );
    await open(page, app);
    await section(page).getByRole("textbox", { name: "Release" }).fill("api@1.0.0");
    await adopt(page).click();
    await page
      .getByRole("button", { name: "Record api@1.0.0 on prod without changing the target" })
      .click();
    await expect(section(page).getByRole("alert")).toHaveText(
      "Live differs from the chosen release.",
    );
    await expect(section(page).getByText("Service/api ports")).toBeVisible();
    await expect(section(page).getByText("Deployment/api image")).toBeVisible();
    await expect(adopt(page)).toHaveCount(0);
    await expect(section(page)).not.toContainText("adopt refused");
    await shot(page, "adopt-differences");
    await expectDesignRules(page);
  });

  test("pending approval hides Adopt and links the plan", async ({ page }) => {
    app = await serveConsole(server({ plan: adoptPlan("computed") }));
    await open(page, app);
    await expect(section(page).getByRole("status")).toHaveText(
      "Adoption recorded; the plan needs signed approval.",
    );
    await expect(section(page).getByRole("link", { name: "Open plan" })).toBeVisible();
    await expect(adopt(page)).toHaveCount(0);
    await shot(page, "adopt-pending");
    await expectDesignRules(page);
  });

  test("adopted: recorded as deployed, no Adopt", async ({ page }) => {
    app = await serveConsole(server({ unmanaged: false, plan: adoptPlan("succeeded") }));
    await open(page, app);
    await expect(section(page).getByRole("status")).toHaveText("Recorded as deployed.");
    await expect(adopt(page)).toHaveCount(0);
    await shot(page, "adopt-adopted");
    await expectDesignRules(page);
  });

  test("no permission hides Adopt", async ({ page }) => {
    app = await serveConsole(server({ capabilities: ["read"] }));
    await open(page, app);
    await expect(section(page).getByRole("row").nth(1)).toContainText("api");
    await expect(adopt(page)).toHaveCount(0);
    await shot(page, "adopt-no-permission");
    await expectDesignRules(page);
  });
});

test.describe("unmanaged adoption on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("keeps unmanaged inside the viewport", async ({ page }) => {
    app = await serveConsole(server({}));
    await open(page, app);
    await expect(section(page).getByRole("table")).toBeVisible();
    const box = await section(page).boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
    await shot(page, "adopt-phone");
    await expectDesignRules(page);
  });
});
