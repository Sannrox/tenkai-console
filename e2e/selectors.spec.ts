// Selector match preview and hold by selector against a mocked API. Run with `pnpm build && pnpm e2e`.
import { mkdirSync } from "node:fs";
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

const NAMES = ["prod", "stage", "batch"];

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

const RECORD = { selector: "tier=web", environments: ["prod", "stage"] };
const HELD: DeliveryHold = {
  actor: "alice",
  held_at: 1_700_000_900_000,
  reason: "web freeze",
  selector: RECORD,
};

const ok = (body: unknown): Reply => ({ status: 200, body });
const entry = (name: string) => ({ id: `env:${name}`, name, description: "fixture" });

/** The `GET /v1/environments?selector=` answer for each selector a scenario types. */
type Matches = (selector: string) => Reply;

const WEB: Matches = (selector) =>
  selector === "tier=web"
    ? ok([entry("prod"), entry("stage"), entry("prod")])
    : selector === "tier=web,=prod"
      ? {
          status: 400,
          body: {
            error: "selector clause =prod has an empty key",
            reason: { code: "invalid_selector", next: "correct the selector and retry" },
            clause: "=prod",
          },
        }
      : ok([]);

type Scenario = { matches: Matches; held: Set<string>; holds: unknown[]; selectors: string[] };

const server =
  (scenario: Scenario): Routes =>
  (path, request) => {
    const search = new URL(request.url ?? "/", "http://local").searchParams;
    if (path === "/v1/auth/oidc") {
      return { status: 404, body: { error: "no oidc client" } };
    }
    if (path === "/v1/auth/me") {
      return ok(ME);
    }
    if (path === "/v1/fleet/status") {
      return ok(FLEET);
    }
    if (path === "/v1/channels") {
      return ok({ items: [] });
    }
    if (path === "/v1/environments") {
      const selector = search.get("selector");
      if (selector === null) {
        return ok(NAMES.map(entry));
      }
      scenario.selectors.push(selector);
      return scenario.matches(selector);
    }
    const [name, rest] = path.split("/").slice(3);
    if (name === undefined || !NAMES.includes(name)) {
      return undefined;
    }
    const held = scenario.held.has(name);
    if (rest === undefined) {
      return ok({
        id: `env:${name}`,
        name,
        description: "fixture",
        execution_note: "",
        facts: {},
        lease: { held: true, generation: name === "prod" ? 4 : 7, status: "held" },
        latest_plan: null,
        subscriptions: [{ product: "web", channel: "stable", head: "1.0.0", state: "current" }],
        ...(held ? { delivery_hold: HELD } : {}),
      } as unknown as EnvironmentInspectReport);
    }
    if (rest === "hold") {
      return undefined;
    }
    if (rest === "runtime") {
      return ok({ environment: name, components: [] });
    }
    if (rest === "dependencies") {
      return ok({ environment: name, holds: [], products: [] });
    }
    if (rest === "history") {
      return ok({ items: [] });
    }
    return undefined;
  };

/** Serve a scenario; hold reads and writes go through the page so POST bodies are seen. */
const start = async (page: Page, matches: Matches): Promise<[MockBackend, Scenario]> => {
  const scenario: Scenario = { matches, held: new Set(), holds: [], selectors: [] };
  const app = await serveConsole(server(scenario));
  await page.route(/\/v1\/environments\/[^/]+\/hold$/, async (route) => {
    const name = new URL(route.request().url()).pathname.split("/")[3] ?? "";
    if (route.request().method() === "POST") {
      scenario.holds.push(route.request().postDataJSON());
      scenario.held.add(name);
      await route.fulfill({ json: { version: 1, operation: "hold", message: `held ${name}` } });
      return;
    }
    const view: DeliveryHoldView = scenario.held.has(name)
      ? {
          hold: HELD,
          audit: [
            {
              action: "set",
              actor: "alice",
              at: HELD.held_at,
              reason: HELD.reason,
              selector: RECORD,
            },
          ],
        }
      : { audit: [] };
    await route.fulfill({ json: view });
  });
  return [app, scenario];
};

const row = (page: Page, label: string) =>
  page
    .locator("dt", { hasText: new RegExp(`^${label}$`) })
    .locator("xpath=following-sibling::dd[1]");

const open = async (page: Page, app: MockBackend) => {
  await page.goto(`${app.url}environments?environment=prod`);
  await expect(page.getByText("held, generation 4")).toBeVisible();
  await expect(row(page, "delivery hold")).toHaveText("none");
  await page.getByRole("button", { name: "Hold by selector" }).click();
};

const preview = (page: Page) => page.getByLabel("Hold selector match");

const shot = async (page: Page, name: string) => {
  const dir = process.env.LANE_SCREENSHOTS;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
  }
};

test.describe("selectors", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("matches many, holds each with the selector, and records what it resolved to", async ({
    page,
  }) => {
    let scenario: Scenario;
    [app, scenario] = await start(page, WEB);
    await open(page, app);
    await page.getByLabel("Hold selector", { exact: true }).pressSequentially("tier=web", {
      delay: 20,
    });
    await expect(preview(page)).toHaveText("matches 2: prod, stage");
    // Debounced: typing sends one preview, for the settled text only.
    expect(scenario.selectors).toStrictEqual(["tier=web"]);
    await shot(page, "matches-many");
    await page.getByLabel("Selector hold reason").fill("web freeze");
    await page.getByRole("button", { name: "Hold matches" }).click();
    await page.getByRole("button", { name: "Hold 2 by tier=web" }).click();
    await expect(page.getByLabel("Selector hold results")).toHaveText(
      "prod held and audited.stage held and audited.",
    );
    expect(scenario.holds).toStrictEqual([
      {
        version: 1,
        operation: "hold",
        environment: "prod",
        expected_generation: 4,
        reason: "web freeze",
        selector: "tier=web",
      },
      {
        version: 1,
        operation: "hold",
        environment: "stage",
        expected_generation: 7,
        reason: "web freeze",
        selector: "tier=web",
      },
    ]);
    await expect(row(page, "selector")).toHaveText("tier=web, matched prod, stage");
    await expect(page.getByLabel("Hold history")).toContainText(
      "(selector tier=web, matched prod, stage)",
    );
    await expectDesignRules(page);
    await shot(page, "held-by-selector");
  });

  test("matches none and cannot hold", async ({ page }) => {
    [app] = await start(page, WEB);
    await open(page, app);
    await page.getByLabel("Hold selector", { exact: true }).fill("tier=batch");
    await expect(preview(page)).toHaveText("matches none");
    await page.getByLabel("Selector hold reason").fill("web freeze");
    await expect(page.getByRole("button", { name: "Hold matches" })).toBeDisabled();
    await expectDesignRules(page);
    await shot(page, "matches-none");
  });

  test("an invalid selector shows the offending clause", async ({ page }) => {
    [app] = await start(page, WEB);
    await open(page, app);
    await page.getByLabel("Hold selector", { exact: true }).fill("tier=web,=prod");
    await expect(preview(page)).toHaveText("invalid clause: =prod");
    await expect(page.getByRole("button", { name: "Hold matches" })).toBeDisabled();
    await expect(page.locator("body")).not.toContainText("empty key");
    await expectDesignRules(page);
    await shot(page, "invalid");
  });

  test("a match without the environment on screen cannot hold", async ({ page }) => {
    [app] = await start(page, (selector) =>
      selector === "tier=batch" ? ok([entry("batch")]) : ok([]),
    );
    await open(page, app);
    await page.getByLabel("Hold selector", { exact: true }).fill("tier=batch");
    await expect(preview(page)).toHaveText("matches 1: batch");
    await expect(page.getByText("Does not match prod.")).toBeVisible();
    await page.getByLabel("Selector hold reason").fill("x");
    await expect(page.getByRole("button", { name: "Hold matches" })).toBeDisabled();
  });

  test("no access and an older server", async ({ page }) => {
    [app] = await start(page, (selector) =>
      selector === "a=b"
        ? { status: 403, body: { error: "insufficient delivery capability" } }
        : { status: 405, body: { error: "method not allowed" } },
    );
    await open(page, app);
    const input = page.getByLabel("Hold selector", { exact: true });
    await input.fill("a=b");
    await expect(preview(page)).toHaveText("No access");
    await input.fill("c=d");
    await expect(preview(page)).toHaveText("This server cannot match selectors.");
    await expectDesignRules(page);
    await shot(page, "unavailable");
  });

  test("a lost hold answer reads as unknown and is not resent", async ({ page }) => {
    let scenario: Scenario;
    [app, scenario] = await start(page, WEB);
    await page.route(/\/v1\/environments\/prod\/hold$/, async (route) => {
      if (route.request().method() === "POST") {
        scenario.holds.push(route.request().postDataJSON());
        await route.abort("connectionreset");
        return;
      }
      await route.fallback();
    });
    await open(page, app);
    await page.getByLabel("Hold selector", { exact: true }).fill("tier=web");
    await expect(preview(page)).toHaveText("matches 2: prod, stage");
    await page.getByLabel("Selector hold reason").fill("web freeze");
    await page.getByRole("button", { name: "Hold matches" }).click();
    await page.getByRole("button", { name: "Hold 2 by tier=web" }).click();
    await expect(page.getByLabel("Selector hold results")).toHaveText(
      "No answer for prod; the outcome is unknown until the next read.",
    );
    expect(scenario.holds).toHaveLength(1);
  });

  test("phone width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    [app] = await start(page, WEB);
    await open(page, app);
    await page.getByLabel("Hold selector", { exact: true }).fill("tier=web");
    await expect(preview(page)).toHaveText("matches 2: prod, stage");
    // The top bar already overflows a phone on this page; the hold card and
    // its selector field must not.
    const card = page.locator("dl").filter({ hasText: "by selector" }).locator("xpath=..");
    const box = await card.boundingBox();
    expect((box?.x ?? 0) + (box?.width ?? Infinity)).toBeLessThanOrEqual(390);
    expect(await page.locator("body").textContent()).not.toMatch(
      /\bADR\b|#\d+|HTTP \d{3}|\/v1\/|\bat \w+ \(|Error:|\u2014/,
    );
    await shot(page, "phone");
  });
});
