// Canary designation by selector, and the selector on a promotion-policy
// canary cohort, against a mocked API. Run with `pnpm build && pnpm e2e`.
import { mkdirSync } from "node:fs";
import { type Page, expect, test } from "@playwright/test";
import type {
  CanaryDesignation,
  CanaryDesignationRequest,
  FleetStatusReport,
} from "../src/api/tenkai.gen";
import {
  type MockBackend,
  type Reply,
  type Routes,
  expectDesignRules,
  openApp,
  serveConsole,
} from "./mock-backend";

const NAMES = ["prod", "stage", "lab"];

const FLEET: FleetStatusReport = {
  environments: NAMES.map((name) => ({
    id: `env:${name}`,
    name,
    description: "fixture",
    subscription_count: 1,
    products_current: 1,
    products_behind: 0,
    products_missing: 0,
    unhealthy: false,
    health_summary: "ok",
    lease_held: false,
    posture: "current",
  })),
  environment_count: 3,
  environments_current: 3,
  environments_behind: 0,
  environments_unhealthy: 0,
  environments_empty: 0,
};

const ME = {
  principal: "host:uid:1000",
  kind: "human",
  capabilities: ["read", "management"],
  user: "alice",
  groups: ["tenkai-operator"],
  source: "host",
};

const ok = (body: unknown): Reply => ({ status: 200, body });
const entry = (name: string) => ({ id: `env:${name}`, name, description: "fixture" });

const RECORD = { selector: "tier=edge", environments: ["stage", "lab"] };
const STAGE: CanaryDesignation = {
  environment: "stage",
  selector: RECORD,
  set_by: "alice",
  set_at: Date.UTC(2026, 10, 14, 9, 30),
};

type Matches = (selector: string) => Reply;

const EDGE: Matches = (selector) =>
  selector === "tier=edge"
    ? ok([entry("stage"), entry("lab"), entry("stage")])
    : selector === "tier=edge,=prod"
      ? {
          status: 400,
          body: {
            error: "selector clause =prod has an empty key",
            reason: { code: "invalid_selector", next: "correct the selector and retry" },
            clause: "=prod",
          },
        }
      : ok([]);

type Scenario = {
  matches: Matches;
  designations: CanaryDesignation[];
  writes: CanaryDesignationRequest[];
  selectors: string[];
  list: Reply;
};

const server =
  (scenario: Scenario, capabilities = ME.capabilities): Routes =>
  (path, request) => {
    const search = new URL(request.url ?? "/", "http://local").searchParams;
    if (path === "/v1/auth/oidc") {
      return { status: 404, body: { error: "no oidc client" } };
    }
    if (path === "/v1/auth/me") {
      return ok({ ...ME, capabilities });
    }
    if (path === "/v1/fleet/status") {
      return ok(FLEET);
    }
    if (path === "/v1/channels") {
      return ok({ items: [] });
    }
    if (path === "/v1/events") {
      return ok({ events: [], next_cursor: "0" });
    }
    if (path === "/v1/canaries") {
      return scenario.list;
    }
    if (path === "/v1/environments") {
      const selector = search.get("selector");
      if (selector === null) {
        return ok(NAMES.map(entry));
      }
      scenario.selectors.push(selector);
      return scenario.matches(selector);
    }
    return undefined;
  };

const start = async (
  page: Page,
  matches: Matches,
  designations: CanaryDesignation[] = [STAGE],
  capabilities = ME.capabilities,
): Promise<[MockBackend, Scenario]> => {
  const scenario: Scenario = {
    matches,
    designations: [...designations],
    writes: [],
    selectors: [],
    list: ok(designations),
  };
  const app = await serveConsole(server(scenario, capabilities));
  await page.route("**/v1/canaries", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    const body = route.request().postDataJSON() as CanaryDesignationRequest;
    scenario.writes.push(body);
    const matched = body.selector === "tier=edge" ? ["lab", "stage"] : [];
    scenario.designations = body.designated
      ? matched.map((environment) => ({
          environment,
          selector: { selector: "tier=edge", environments: matched },
          set_by: "alice",
          set_at: Date.UTC(2026, 10, 14, 10),
        }))
      : [];
    scenario.list = ok(scenario.designations);
    await route.fulfill({
      json: {
        designated: body.designated,
        environments: matched,
        selector: body.designated ? { selector: "tier=edge", environments: matched } : undefined,
      },
    });
  });
  return [app, scenario];
};

const section = (page: Page) => page.getByRole("region", { name: "Canary designations" });
const selector = (page: Page) => page.getByRole("textbox", { name: "Canary selector" });
const preview = (page: Page) => page.getByLabel("Canary selector match");
const designate = (page: Page) => page.getByRole("button", { name: "Designate", exact: true });
const undesignate = (page: Page) => page.getByRole("button", { name: "Undesignate", exact: true });

const open = async (page: Page, app: MockBackend) => {
  await page.goto(app.url);
  await openApp(page, "Exposure");
  await expect(section(page).getByRole("heading", { name: "Canary designations" })).toBeVisible();
};

const shot = async (page: Page, name: string) => {
  const dir = process.env.LANE_SCREENSHOTS;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
  }
};

test.describe("canary designations", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("lists a selector designation and the environments it resolved to", async ({ page }) => {
    [app] = await start(page, EDGE);
    await open(page, app);
    const row = section(page).getByRole("row").filter({ hasText: "stage" });
    await expect(row).toContainText("tier=edge, matched stage, lab");
    await expect(row).toContainText("alice at 2026-11-14T09:30Z");
    await expectDesignRules(page);
    await shot(page, "listed");
  });

  test("designates the preview match by selector", async ({ page }) => {
    let scenario: Scenario;
    [app, scenario] = await start(page, EDGE, []);
    await open(page, app);
    await expect(section(page)).toContainText("No canary designations.");
    await selector(page).pressSequentially("tier=edge", { delay: 20 });
    await expect(preview(page)).toHaveText("matches 2: lab, stage");
    expect(scenario.selectors).toStrictEqual(["tier=edge"]);
    await shot(page, "matches-many");
    await designate(page).click();
    await page.getByRole("button", { name: "Designate 2 by tier=edge" }).click();
    await expect(section(page).getByRole("status")).toHaveText("Designated and audited.");
    expect(scenario.writes).toStrictEqual([{ designated: true, selector: "tier=edge" }]);
    await expect(section(page).getByRole("cell", { name: "lab", exact: true })).toBeVisible();
    await expect(section(page).getByRole("cell", { name: "stage", exact: true })).toBeVisible();
    await expect(section(page).getByRole("table")).toContainText("tier=edge, matched lab, stage");
    await expectDesignRules(page);
    await shot(page, "designated");
  });

  test("matches none and cannot designate", async ({ page }) => {
    [app] = await start(page, EDGE, []);
    await open(page, app);
    await selector(page).fill("tier=core");
    await expect(preview(page)).toHaveText("matches none");
    await expect(designate(page)).toBeDisabled();
    await expect(undesignate(page)).toBeDisabled();
    await expectDesignRules(page);
    await shot(page, "matches-none");
  });

  test("an invalid selector shows the offending clause", async ({ page }) => {
    [app] = await start(page, EDGE, []);
    await open(page, app);
    await selector(page).fill("tier=edge,=prod");
    await expect(preview(page)).toHaveText("invalid clause: =prod");
    await expect(designate(page)).toBeDisabled();
    await expect(page.locator("body")).not.toContainText("empty key");
    await expectDesignRules(page);
    await shot(page, "invalid");
  });

  test("an older server says designations are unavailable", async ({ page }) => {
    const scenario: Scenario = {
      matches: EDGE,
      designations: [],
      writes: [],
      selectors: [],
      list: { status: 404, body: { error: "not found" } },
    };
    app = await serveConsole(server(scenario));
    await open(page, app);
    await expect(section(page)).toContainText("This server does not report canary designations.");
    await expect(section(page).getByRole("table")).toHaveCount(0);
    await expect(designate(page)).toHaveCount(0);
    await expectDesignRules(page);
    await shot(page, "older-server");
  });

  test("offers no write without the permission", async ({ page }) => {
    [app] = await start(page, EDGE, [STAGE], ["read"]);
    await open(page, app);
    await expect(section(page).getByRole("row").filter({ hasText: "stage" })).toBeVisible();
    await expect(selector(page)).toHaveCount(0);
    await expect(designate(page)).toHaveCount(0);
    await expectDesignRules(page);
    await shot(page, "no-permission");
  });

  test("a lost write reads as unknown and is sent once", async ({ page }) => {
    let scenario: Scenario;
    [app, scenario] = await start(page, EDGE, []);
    let attempts = 0;
    await page.unroute("**/v1/canaries");
    await page.route("**/v1/canaries", async (route) => {
      if (route.request().method() === "POST") {
        attempts += 1;
        scenario.writes.push(route.request().postDataJSON() as CanaryDesignationRequest);
        await route.abort("connectionreset");
        return;
      }
      await route.fallback();
    });
    await open(page, app);
    await selector(page).fill("tier=edge");
    await expect(preview(page)).toHaveText("matches 2: lab, stage");
    await designate(page).click();
    await page.getByRole("button", { name: "Designate 2 by tier=edge" }).click();
    await expect(section(page).getByRole("status")).toHaveText(/outcome is unknown/);
    await page.waitForLoadState("networkidle");
    expect(attempts).toBe(1);
    expect(scenario.writes).toHaveLength(1);
    await expect(section(page).getByRole("status")).not.toHaveText(/audited/);
    await shot(page, "lost");
    await expectDesignRules(page);
  });

  test("phone width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    [app] = await start(page, EDGE);
    await open(page, app);
    await expect(section(page).getByRole("row").filter({ hasText: "stage" })).toBeVisible();
    await expectDesignRules(page);
    await shot(page, "phone");
  });
});
