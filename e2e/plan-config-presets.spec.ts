// Config presets and override conflicts on the plan and overlays, against a
// mocked API. Run with `pnpm build && pnpm e2e`.
import { type Page, expect, test } from "@playwright/test";
import type { EnvironmentInspectReport, EnvironmentPlanSummary } from "../src/api/tenkai.gen";
import {
  type MockBackend,
  type Reply,
  type Routes,
  expectDesignRules,
  openEnvironment,
  openEnvironmentTab,
  serveConsole,
} from "./mock-backend";

type Preset = {
  product: string;
  preset: string;
  from_preset?: string[];
  overridden?: string[];
  conflicts?: string[];
};

const planWith = (presets: Preset[] | undefined) =>
  ({
    id: "tenkai:plan:1",
    state: "computed",
    created_at: 1,
    step_count: 1,
    digest: "sha256:abc",
    ...(presets === undefined ? {} : { config_presets: presets }),
    steps: [
      {
        id: "s1",
        order: 1,
        product: "api",
        action: "upgrade",
        release_id: "rel:1",
        from: "1.0.0",
        to: "1.1.0",
      },
    ],
  }) as unknown as EnvironmentPlanSummary;

const inspect = (
  latest: EnvironmentPlanSummary | null,
  config?: unknown,
): EnvironmentInspectReport =>
  ({
    id: "env:prod",
    name: "prod",
    description: "fixture",
    execution_note: "",
    facts: {},
    lease: { held: false, status: "free" },
    latest_plan: latest,
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
    ...(config === undefined ? {} : { config }),
  }) as unknown as EnvironmentInspectReport;

const ok = (body: unknown): Reply => ({ status: 200, body });

const HOST_ME = {
  principal: "host:uid:1000",
  kind: "human",
  capabilities: ["read", "management"],
  user: "alice",
  groups: [],
  source: "host",
};

const FLEET = {
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

const server = (environment: Reply): Routes => {
  return (rawPath) => {
    const path = decodeURIComponent(rawPath);
    if (path === "/v1/auth/oidc") {
      return { status: 404, body: { error: "no oidc client" } };
    }
    if (path === "/v1/auth/me") {
      return ok(HOST_ME);
    }
    if (path === "/v1/environments") {
      return ok([{ id: "env:prod", name: "prod", description: "fixture" }]);
    }
    if (path === "/v1/fleet/status") {
      return ok(FLEET);
    }
    if (path === "/v1/channels") {
      return ok({ items: [] });
    }
    if (path === "/v1/environments/prod") {
      return environment;
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
    if (path === "/v1/plans/tenkai:plan:1/approvals") {
      return ok({
        plan_id: "tenkai:plan:1",
        plan_digest: "sha256:abc",
        purpose: "execute_plan",
        required: 1,
        groups: ["ops"],
        exclude_requester: false,
        collected: [],
        missing: 1,
      });
    }
    return undefined;
  };
};

const presets = (page: Page) => page.getByRole("region", { name: "Config presets" });

const openPlan = async (page: Page, app: MockBackend) => {
  await page.goto(app.url);
  await expect(page.getByRole("heading", { name: "Environments" })).toBeVisible();
  await page.evaluate(() => {
    history.pushState({}, "", `${location.pathname}environments/prod/plan`);
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await page.waitForLoadState("networkidle");
};

const capture = (page: Page, name: string) =>
  page.screenshot({ path: test.info().outputPath(`${name}.png`) });

const expectRules = async (page: Page, region = true) => {
  const width = page.viewportSize()?.width ?? 0;
  if (width >= 1024) {
    await expectDesignRules(page);
    return;
  }
  if (region) {
    const box = await presets(page).evaluate((node) => ({
      right: node.getBoundingClientRect().right,
      overflow: node.scrollWidth - node.clientWidth,
    }));
    expect(box.right).toBeLessThanOrEqual(width);
    expect(box.overflow).toBeLessThanOrEqual(0);
  }
  expect(await page.locator("body").textContent()).not.toMatch(
    /\bADR\b|#\d+|HTTP \d{3}|\/v1\/|\bat \w+ \(|Error:|—/,
  );
};

const SELECTED: Preset = {
  product: "api",
  preset: "large",
  from_preset: ["region"],
};

const OVERRIDES: Preset = {
  product: "api",
  preset: "large",
  from_preset: ["region"],
  overridden: ["replicas"],
};

const CONFLICTS: Preset = {
  ...OVERRIDES,
  conflicts: ["replicas: override 3 hides preset large change 5 -> 8"],
};

for (const viewport of [
  { name: "desktop", width: 1280, height: 800 },
  { name: "phone", width: 390, height: 844 },
]) {
  test.describe(`config presets on ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });
    let app: MockBackend;
    test.afterEach(async () => {
      await app.close();
    });

    test("says no presets when the server sends none", async ({ page }) => {
      app = await serveConsole(server(ok(inspect(planWith(undefined)))));
      await openPlan(page, app);
      await expect(presets(page).getByText("No presets on this plan")).toBeVisible();
      await expect(page.getByRole("button", { name: "Approve only" })).toBeVisible();
      await capture(page, `none-${viewport.name}`);
      await expectRules(page);
    });

    test("names the selected preset and keys it supplies", async ({ page }) => {
      app = await serveConsole(server(ok(inspect(planWith([SELECTED])))));
      await openPlan(page, app);
      const region = presets(page);
      await expect(region.getByText("api preset large")).toBeVisible();
      await expect(region.getByText("from preset: region")).toBeVisible();
      await expect(region.getByText("Nothing is changed without a plan")).toHaveCount(0);
      await capture(page, `selected-${viewport.name}`);
      await expectRules(page);
    });

    test("lists overridden keys beside the preset", async ({ page }) => {
      app = await serveConsole(server(ok(inspect(planWith([OVERRIDES])))));
      await openPlan(page, app);
      const region = presets(page);
      await expect(region.getByText("overridden: replicas")).toBeVisible();
      await expect(region.getByText("from preset: region")).toBeVisible();
      await capture(page, `overrides-${viewport.name}`);
      await expectRules(page);
    });

    test("shows conflicts before signing and does not apply a rebase", async ({ page }) => {
      app = await serveConsole(server(ok(inspect(planWith([CONFLICTS])))));
      await openPlan(page, app);
      const region = presets(page);
      await expect(region.getByRole("alert")).toHaveText(
        "conflict: replicas: override 3 hides preset large change 5 -> 8",
      );
      await expect(region.getByText("Nothing is changed without a plan")).toBeVisible();
      const order = await page.evaluate(() => {
        const lead = document.querySelector('[aria-label="Config presets"]');
        const approval = [...document.querySelectorAll("h2")].find(
          (heading) => heading.textContent === "Approval",
        );
        return Boolean(
          lead &&
          approval &&
          lead.compareDocumentPosition(approval) & Node.DOCUMENT_POSITION_FOLLOWING,
        );
      });
      expect(order).toBe(true);
      await capture(page, `conflicts-${viewport.name}`);
      await expectRules(page);
    });

    test("hides the plan when inspect is refused", async ({ page }) => {
      app = await serveConsole(server({ status: 403, body: { error: "forbidden" } }));
      await openPlan(page, app);
      await expect(page.getByRole("alert")).toHaveText("No access to this plan");
      await expect(presets(page)).toHaveCount(0);
      await expect(page.getByText("forbidden")).toHaveCount(0);
      await capture(page, `forbidden-${viewport.name}`);
      await expectRules(page, false);
    });
  });
}

test.describe("config presets on overlays", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("marks overlay and preset sources on the environment", async ({ page }) => {
    app = await serveConsole(
      server(
        ok(
          inspect(planWith([OVERRIDES]), [
            {
              product: "api",
              overlay: { replicas: "3" },
              defaults: { region: "us", colour: "blue" },
            },
          ]),
        ),
      ),
    );
    await page.goto(app.url);
    await openEnvironment(page);
    await openEnvironmentTab(page, "Settings");
    await expect(page.getByText("api preset large")).toBeVisible();
    const table = page.locator("table").filter({
      has: page.getByRole("columnheader", { name: "Source" }),
    });
    await expect(table.getByRole("cell", { name: "replicas", exact: true })).toBeVisible();
    await expect(table.getByRole("cell", { name: "overlay", exact: true })).toBeVisible();
    await expect(table.getByRole("cell", { name: "preset", exact: true })).toBeVisible();
    await expect(table.getByRole("cell", { name: "default", exact: true })).toBeVisible();
    await expectDesignRules(page);
  });
});
