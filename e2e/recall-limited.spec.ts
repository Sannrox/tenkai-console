// Limited recall removal, range exclusions, instance count, and widen,
// against a mocked API. Run with `pnpm build && pnpm e2e`.
import { type Page, expect, test } from "@playwright/test";
import type {
  ChangeEvent,
  ChannelPromotionPolicyStatus,
  ChannelPromotionPolicyView,
  ChannelRecallRuleRequest,
  FleetStatusReport,
  RecallView,
  RecallWidenRequest,
} from "../src/api/tenkai.gen";
import {
  type MockBackend,
  type Reply,
  type Routes,
  expectDesignRules,
  gotoProduct,
  openActions,
  openProductTab,
  serveConsole,
} from "./mock-backend";

const ok = (body: unknown): Reply => ({ status: 200, body });

const STATUS: ChannelPromotionPolicyStatus = {
  product: "api",
  source_channel: "candidate",
  target_channel: "stable",
  policy_id: "channel-promotion-policy:api/stable",
  policy_version: 2,
  paused: false,
  state: "soaking",
};

const FLEET: FleetStatusReport = {
  environments: [],
  environment_count: 0,
  environments_current: 0,
  environments_behind: 0,
  environments_unhealthy: 0,
  environments_empty: 0,
  promotion_policies: [STATUS],
};

const VIEW: ChannelPromotionPolicyView = {
  ...STATUS,
  soak_duration_ms: 3_600_000,
  evidence: {
    health_slo: true,
    healthy_min_share: 0.95,
    failing_max_share: 0.05,
    failing_max_instances: 3,
    recall_on_failing: true,
  },
};

const remaining = (environment: string, instance: string) => ({
  environment,
  instance,
  deployed: "api@1.2.0",
  remaining: true,
});

const LIMITED: RecallView = {
  release: "api@1.2.0",
  covers_future: false,
  recalled_at: Date.UTC(2026, 10, 22, 14, 8),
  recalled_by: "channel-promotion-policy",
  principal_kind: "channel_promotion_policy",
  policy_id: "channel-promotion-policy:api/stable",
  policy_version: "3",
  reason: "soak failing instances reached 3",
  failing_instances: ["lab/api-b", "stage/api", "prod/api-a"],
  failing_instance_count: 3,
  failing_max_instances: 3,
  healthy_share: 0.91,
  failing_share: 0.09,
  range: "api [1.0.0, 1.3.0)",
  removal_scope: ["lab", "stage"],
  removal_environments: [
    { environment: "lab", done: 1, total: 2 },
    { environment: "stage", done: 0, total: 1 },
  ],
  removal_progress: [
    remaining("lab", "api-b"),
    remaining("stage", "api"),
    remaining("prod", "api-a"),
  ],
  out_of_scope: [{ environment: "prod", status: "REMOVAL_NOT_IN_SCOPE" }],
};

const RANGES = {
  items: [
    {
      product: "api",
      from: "1.0.0",
      before: "1.3.0",
      covers_future: false,
      actor: "oidc:alice",
      reason: "defect",
      recorded_at: Date.UTC(2026, 10, 21, 9, 40),
      exclusions: [
        {
          version: "1.1.0",
          actor: "oidc:alice",
          reason: "canary still needed",
          recorded_at: Date.UTC(2026, 10, 21, 9, 40),
        },
      ],
    },
  ],
};

const event = (cursor: number, resource: string): ChangeEvent => ({
  cursor: String(cursor),
  occurred_at: Date.UTC(2026, 10, 22, 9, cursor),
  kind: "release_recalled",
  resource,
});

const EVENTS = [event(1, "api@1.2.0")];
const MANAGER = ["read", "publish", "management"];

const server =
  (capabilities = MANAGER, recall: RecallView | Reply = LIMITED): Routes =>
  (path, request) => {
    if (path === "/v1/products/api/channels/stable/policy") {
      return request.method === "PUT" ? ok({ message: "set" }) : ok(VIEW);
    }
    if (path === "/v1/products/api/recall-ranges") {
      return ok(RANGES);
    }
    const found = /^\/v1\/releases\/([^/]+)\/recall$/.exec(path);
    if (found && (request.method ?? "GET") === "GET") {
      if ("status" in recall && "body" in recall) {
        return recall;
      }
      return decodeURIComponent(found[1] ?? "") === LIMITED.release
        ? ok(recall)
        : { status: 404, body: { error: "not recalled" } };
    }
    if (path === "/healthz") {
      return ok({
        status: "ok",
        profile: "fixture",
        capabilities: ["channel_promotion_policy:v1"],
        contracts: ["tenkai.http.v1"],
      });
    }
    if (path === "/v1/auth/oidc") {
      return { status: 404, body: { error: "no oidc client" } };
    }
    if (path === "/v1/auth/me") {
      return ok({
        principal: "host:uid:1000",
        kind: "human",
        capabilities,
        user: "alice",
        groups: ["tenkai-operator"],
        source: "host",
      });
    }
    if (path === "/v1/fleet/status") {
      return ok(FLEET);
    }
    if (path === "/v1/events") {
      return ok({ events: EVENTS, next_cursor: String(EVENTS.length) });
    }
    if (path === "/v1/environments") {
      return ok([]);
    }
    if (path === "/v1/channels") {
      return ok({ items: [] });
    }
    return undefined;
  };

const detail = (page: Page) => page.getByRole("region", { name: "Recall detail" });
const editor = (page: Page) =>
  page.getByRole("region", { name: "Policy detail" }).getByRole("group", { name: "Recall rule" });
const widen = (page: Page) => page.getByRole("group", { name: "Widen removal" });
const rows = (page: Page) =>
  detail(page).getByRole("table", { name: "Environments" }).getByRole("row");

const openReleases = async (page: Page, app: MockBackend) => {
  await page.goto(app.url);
  await gotoProduct(page, "api");
  await openProductTab(page, "Recalls");
  await expect(page.getByRole("heading", { name: "Recall follow-through" })).toBeVisible();
};

const openRecall = async (page: Page, app: MockBackend) => {
  await openReleases(page, app);
  await page.getByRole("button", { name: "Detail api@1.2.0" }).click();
  await expect(detail(page).getByRole("table", { name: "Environments" })).toBeVisible();
  await page.waitForLoadState("networkidle");
};

const openReleaseWiden = async (page: Page, app: MockBackend) => {
  await page.goto(app.url);
  await expect(page.getByRole("heading", { name: "Environments" })).toBeVisible();
  await page.evaluate(() => {
    history.pushState({}, "", `${location.pathname}releases/api/1.2.0`);
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page.getByRole("heading", { name: "api@1.2.0", exact: true })).toBeVisible();
  await openActions(page);
  await expect(widen(page)).toBeVisible();
};

const shot = (page: Page, name: string) =>
  page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });

test.describe("limited recall removal", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("the environment table is the recall, with keep out of scope and exclusions as values", async ({
    page,
  }) => {
    app = await serveConsole(server());
    await openRecall(page, app);
    await expect(detail(page).getByLabel("Measured")).toHaveText(
      "healthy 91% · failing 9% · threshold 3 instances, reached",
    );
    await expect(detail(page).getByLabel("Range")).toHaveText(
      "Range api [1.0.0, 1.3.0) · closed, excluding 1.1.0 by oidc:alice (canary still needed)",
    );
    await expect(rows(page)).toHaveText([
      "EnvironmentScopeRemovedStill running",
      "labremove1 of 2api-b",
      "stageremove0 of 1api",
      "prodkeepapi-a",
    ]);
    await expect(detail(page).getByLabel("Removal", { exact: true })).toContainText(
      "prod is recalled, removal not in scope",
    );
    await expect(detail(page).getByRole("group", { name: "Widen removal" })).toHaveCount(0);
    await shot(page, "recall-limited");
    await expectDesignRules(page);
  });

  test("widens with one audited request naming the environments", async ({ page }) => {
    let body: RecallWidenRequest | undefined;
    app = await serveConsole(server());
    await page.route("**/v1/releases/*/recall/widen", async (route) => {
      if (route.request().method() === "POST") {
        body = route.request().postDataJSON() as RecallWidenRequest;
        await route.fulfill({ json: { message: "widened" } });
        return;
      }
      await route.fallback();
    });
    await openReleaseWiden(page, app);
    await widen(page).getByRole("textbox", { name: "Add to removal" }).fill("prod");
    await widen(page).getByRole("textbox", { name: "Reason" }).fill("lab canary done");
    await widen(page).getByRole("button", { name: "Widen removal" }).click();
    await widen(page).getByRole("button", { name: "Widen removal of api@1.2.0 with prod" }).click();
    await expect(widen(page).getByRole("status")).toHaveText("Removal widened and audited.");
    expect(body).toEqual({
      version: 1,
      operation: "recall",
      reason: "lab canary done",
      environments: ["prod"],
    });
    await shot(page, "recall-widened");
    await expectDesignRules(page);
  });

  test("a lost widen reads as unknown and is sent once", async ({ page }) => {
    let attempts = 0;
    app = await serveConsole(server());
    await page.route("**/v1/releases/*/recall/widen", async (route) => {
      if (route.request().method() === "POST") {
        attempts += 1;
        await route.abort("connectionreset");
        return;
      }
      await route.fallback();
    });
    await openReleaseWiden(page, app);
    await widen(page).getByRole("textbox", { name: "Add to removal" }).fill("prod");
    await widen(page).getByRole("textbox", { name: "Reason" }).fill("lab canary done");
    await widen(page).getByRole("button", { name: "Widen removal" }).click();
    await widen(page).getByRole("button", { name: "Widen removal of api@1.2.0 with prod" }).click();
    await expect(page.getByRole("status").filter({ hasText: /outcome is unknown/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "api@1.2.0" })).toBeVisible();
    await expect(page.getByText("outcome unknown")).toBeVisible();
    expect(attempts).toBe(1);
    await expect(page.getByText("Removal widened and audited.")).toHaveCount(0);
    await shot(page, "recall-lost-widen");
    await expectDesignRules(page);
  });

  test("405 on widen is a refusal, not unknown", async ({ page }) => {
    app = await serveConsole(server());
    await page.route("**/v1/releases/*/recall/widen", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({ status: 405, json: { error: "method" } });
        return;
      }
      await route.fallback();
    });
    await openReleaseWiden(page, app);
    await widen(page).getByRole("textbox", { name: "Add to removal" }).fill("prod");
    await widen(page).getByRole("textbox", { name: "Reason" }).fill("lab canary done");
    await widen(page).getByRole("button", { name: "Widen removal" }).click();
    await widen(page).getByRole("button", { name: "Widen removal of api@1.2.0 with prod" }).click();
    await expect(widen(page).getByRole("alert")).toHaveText("This server cannot widen removal.");
    await expect(page.locator("body")).not.toContainText("method");
    await shot(page, "recall-widen-old");
    await expectDesignRules(page);
  });

  test("no permission hides widen and still shows scope", async ({ page }) => {
    app = await serveConsole(server(["read"]));
    await openRecall(page, app);
    await expect(rows(page)).toHaveText([
      "EnvironmentScopeRemovedStill running",
      "labremove1 of 2api-b",
      "stageremove0 of 1api",
      "prodkeepapi-a",
    ]);
    await expect(widen(page)).toHaveCount(0);
    await shot(page, "recall-limited-no-permission");
    await expectDesignRules(page);
  });

  test("an omitted scope list does not invent fleet-wide or offer widen", async ({ page }) => {
    const omitted = (({ removal_scope: _scope, out_of_scope: _held, ...rest }: RecallView) => rest)(
      LIMITED,
    );
    app = await serveConsole(server(["read"], omitted));
    await openRecall(page, app);
    await expect(rows(page).first()).toHaveText("EnvironmentRemovedStill running");
    await expect(detail(page)).not.toContainText("keep");
    await expect(widen(page)).toHaveCount(0);
    await expectDesignRules(page);
  });

  test("the recall rule sentence names an optional instance count", async ({ page }) => {
    let body: ChannelRecallRuleRequest | undefined;
    app = await serveConsole(server());
    await page.route("**/v1/products/api/channels/stable/policy", async (route) => {
      if (route.request().method() === "PUT") {
        body = route.request().postDataJSON() as ChannelRecallRuleRequest;
        await route.fulfill({ json: { message: "set" } });
        return;
      }
      await route.fallback();
    });
    await page.goto(app.url);
    await gotoProduct(page, "api");
    await page.getByRole("button", { name: "Detail api stable" }).click();
    await expect(page.getByRole("region", { name: "Policy detail" })).toContainText(
      "when failing > 5% of 1h soak, or 3 instances",
    );
    await expect(editor(page).getByRole("textbox", { name: "Failing max instances" })).toHaveValue(
      "3",
    );
    await editor(page).getByRole("textbox", { name: "Failing max instances" }).fill("4");
    await editor(page).getByRole("button", { name: "Set recall rule" }).click();
    await editor(page)
      .getByRole("button", {
        name: "Set api stable v2: soak 1h, recall when failing > 0.05 or 4 instances",
      })
      .click();
    await expect(editor(page).getByRole("status")).toHaveText("Recall rule set and audited.");
    expect(body).toMatchObject({
      version: 1,
      operation: "channel_configure",
      expected_generation: 2,
      soak_duration_ms: 3_600_000,
      failing_max_share: 0.05,
      failing_max_instances: 4,
      recall_on_failing: true,
    });
    await shot(page, "rule-instances");
    await expectDesignRules(page);
  });
});

test.describe("limited recall on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("keeps one wrapping table inside the viewport", async ({ page }) => {
    app = await serveConsole(server());
    await openRecall(page, app);
    await expect(detail(page).getByRole("table", { name: "Environments" })).toBeVisible();
    const box = await detail(page).boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
    await shot(page, "recall-limited-phone");
    expect(await page.locator("body").textContent()).not.toMatch(
      /\bADR\b|#\d+|HTTP \d{3}|\/v1\/|\bat \w+ \(|Error:|—/,
    );
  });
});
