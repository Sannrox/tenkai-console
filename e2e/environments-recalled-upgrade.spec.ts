// Advisory-recalled upgrade with lower exposure, against a mocked API.
// Run with `pnpm build && pnpm e2e`.
import { type Page, expect, test } from "@playwright/test";
import type { FleetEnvironmentRow, FleetStatusReport } from "../src/api/tenkai.gen";
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
  subscription_count: 1,
  products_current: 0,
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

const SUBSCRIPTION = {
  product: "api",
  instance: "api",
  channel: "stable",
  head: "1.1.0",
  deployed: "1.0.0",
  state: "behind",
  health: "healthy",
};

const FEED = {
  imported: true,
  imported_at: Date.UTC(2026, 10, 1),
  generated_at: Date.UTC(2026, 10, 1),
  age_ms: 3_600_000,
  advisory_count: 2,
  matches: [
    {
      advisory_id: "TENKAI-2026-1",
      severity: "high",
      component: "openssl",
      component_version: "1.1.1",
      release: "api@1.0.0",
      release_id: "tenkai:release:api@1.0.0",
    },
    {
      advisory_id: "TENKAI-2026-2",
      severity: "high",
      component: "libfoo",
      component_version: "1.0.0",
      release: "api@1.0.0",
      release_id: "tenkai:release:api@1.0.0",
    },
    {
      advisory_id: "TENKAI-2026-1",
      severity: "high",
      component: "openssl",
      component_version: "1.1.1",
      release: "api@1.1.0",
      release_id: "tenkai:release:api@1.1.0",
    },
  ],
};

const ADVISORY_RECALL = {
  release: "api@1.1.0",
  covers_future: false,
  recalled_by: "tenkai",
  recalled_at: Date.UTC(2026, 10, 14, 10, 5),
};

const HEALTH_RECALL = {
  ...ADVISORY_RECALL,
  policy_id: "soak",
  policy_version: "3",
  failing_share: 0.2,
  failing_max_share: 0.1,
};

const RECALL = /^\/v1\/releases\/(?<release>[^/]+)\/recall$/;

const server = (opts: { capabilities?: string[]; recall?: Reply; plan?: Reply }): Routes => {
  const me = { ...VIEWER, capabilities: opts.capabilities ?? MANAGER.capabilities };
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
        latest_plan: null,
        subscriptions: [SUBSCRIPTION],
      });
    }
    if (path === "/v1/environments/prod/status") {
      return ok([SUBSCRIPTION]);
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
    if (path === "/v1/advisory-feed") {
      return ok(FEED);
    }
    const recall = RECALL.exec(path);
    if (recall && (request.method ?? "GET") === "GET") {
      return opts.recall ?? ok(ADVISORY_RECALL);
    }
    if (path === "/v1/environments/prod/plans" && request.method === "POST") {
      return (
        opts.plan ??
        ok({
          version: 1,
          operation: "plan",
          environment: "prod",
          message: "plan computed",
          resource: "tenkai:plan:1",
        })
      );
    }
    return undefined;
  };
};

const section = (page: Page) => page.getByRole("region", { name: "Pending fix" });
const admit = (page: Page) => page.getByRole("button", { name: "Admit lower-exposure upgrade" });

const open = async (page: Page, app: MockBackend) => {
  await page.goto(app.url);
  await openEnvironment(page);
  await openEnvironmentTab(page, "Instances");
  await expect(section(page)).toBeVisible();
};

const shot = (page: Page, name: string) =>
  page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });

test.describe("recalled upgrade with lower exposure", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("lower exposure: both sets and the admit action", async ({ page }) => {
    app = await serveConsole(server({}));
    const bodies: unknown[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/plans")) {
        bodies.push(request.postDataJSON());
      }
    });
    await open(page, app);
    await expect(section(page).getByRole("row").nth(1)).toHaveText(
      /api.*api@1\.0\.0.*api@1\.1\.0.*TENKAI-2026-1 · TENKAI-2026-2.*TENKAI-2026-1/,
    );
    await section(page)
      .getByRole("textbox", { name: "Upgrade reason" })
      .fill("lower libfoo exposure");
    await admit(page).click();
    await page.getByRole("button", { name: "Admit prod onto the recalled release" }).click();
    await expect(section(page).getByRole("status")).toHaveText(
      "Upgrade admitted onto the recalled release.",
    );
    expect(bodies).toEqual([
      {
        version: 1,
        operation: "plan",
        environment: "prod",
        expected_generation: 0,
        recalled_upgrade_reason: "lower libfoo exposure",
      },
    ]);
    await shot(page, "recalled-upgrade-lower");
    await expectDesignRules(page);
  });

  test("equal or higher: refusal hides the action", async ({ page }) => {
    app = await serveConsole(
      server({
        plan: {
          status: 409,
          body: {
            error:
              "recalled_upgrade_not_lower: api@1.1.0 blocking advisories [TENKAI-2026-1] are not a proper subset of api@1.0.0 [TENKAI-2026-1]",
          },
        },
      }),
    );
    await open(page, app);
    await section(page).getByRole("textbox", { name: "Upgrade reason" }).fill("still exposed");
    await admit(page).click();
    await page.getByRole("button", { name: "Admit prod onto the recalled release" }).click();
    await expect(section(page).getByRole("alert")).toHaveText("Exposure is not lower.");
    await expect(admit(page)).toHaveCount(0);
    await expect(section(page)).not.toContainText("recalled_upgrade");
    await shot(page, "recalled-upgrade-equal");
    await expectDesignRules(page);
  });

  test("health recall shows no admit action", async ({ page }) => {
    app = await serveConsole(server({ recall: ok(HEALTH_RECALL) }));
    await open(page, app);
    await expect(
      section(page).getByText("Health recall; no lower-exposure upgrade."),
    ).toBeVisible();
    await expect(admit(page)).toHaveCount(0);
    await shot(page, "recalled-upgrade-health");
    await expectDesignRules(page);
  });

  test("no permission hides the admit action", async ({ page }) => {
    app = await serveConsole(server({ capabilities: ["read"] }));
    await open(page, app);
    await expect(section(page).getByRole("row").nth(1)).toContainText("api@1.0.0");
    await expect(admit(page)).toHaveCount(0);
    await shot(page, "recalled-upgrade-no-permission");
    await expectDesignRules(page);
  });
});

test.describe("recalled upgrade on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("keeps the pending fix inside the viewport", async ({ page }) => {
    app = await serveConsole(server({}));
    await open(page, app);
    await expect(section(page).getByRole("table")).toBeVisible();
    const box = await section(page).boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
    await shot(page, "recalled-upgrade-phone");
    await expectDesignRules(page);
  });
});
