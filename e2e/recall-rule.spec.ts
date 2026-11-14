// Recall rule edit on a promotion policy, and measured shares and removal
// counts on a recall, against a mocked API. Run with `pnpm build && pnpm e2e`.
import { type Page, expect, test } from "@playwright/test";
import type {
  ChangeEvent,
  ChannelPromotionPolicyStatus,
  ChannelPromotionPolicyView,
  ChannelRecallRuleRequest,
  FleetStatusReport,
  RecallView,
} from "../src/api/tenkai.gen";
import {
  type MockBackend,
  type Reply,
  type Routes,
  expectDesignRules,
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
  evidence: { health_slo: true, healthy_min_share: 0.95, failing_max_share: 0.05 },
};

const event = (cursor: number, resource: string): ChangeEvent => ({
  cursor: String(cursor),
  occurred_at: Date.UTC(2026, 10, 14, 9, cursor),
  kind: "release_recalled",
  resource,
});

const remaining = (environment: string, instance: string) => ({
  environment,
  instance,
  deployed: "api@1.4.0",
  remaining: true,
});

const POLICY_RECALL = {
  policy_id: "channel-promotion-policy:api/stable",
  policy_version: "2",
  principal_kind: "channel_promotion_policy",
  recalled_by: "channel-promotion-policy",
  recalled_at: Date.UTC(2026, 10, 14, 10, 5),
  covers_future: false,
};

// A measured policy recall, an operator recall with counts and no shares, and
// a policy recall recorded before the server kept measures.
const RECALLS: Record<string, RecallView> = {
  "api@1.4.0": {
    ...POLICY_RECALL,
    release: "api@1.4.0",
    reason: "failing share over threshold",
    healthy_share: 0.88,
    failing_share: 0.12,
    failing_max_share: 0.05,
    removal_environments: [
      { environment: "lab", done: 2, total: 2 },
      { environment: "prod", done: 1, total: 3 },
    ],
    removal_progress: [remaining("prod", "api-b"), remaining("prod", "api-c")],
  },
  "billing@2.0.0": {
    release: "billing@2.0.0",
    recalled_by: "oidc:alice",
    principal_kind: "human",
    reason: "bad migration",
    covers_future: false,
    removal_environments: [{ environment: "prod", done: 1, total: 1 }],
  },
  "web@3.0.0": {
    ...POLICY_RECALL,
    release: "web@3.0.0",
    removal_environments: [{ environment: "prod", done: 0, total: 1 }],
    removal_progress: [remaining("prod", "web")],
  },
};

const EVENTS = [event(1, "web@3.0.0"), event(2, "billing@2.0.0"), event(3, "api@1.4.0")];

const MANAGER = ["read", "publish", "management"];

/** `write` answers the recall rule PUT; the policy always reads as `VIEW`. */
const server =
  (capabilities = MANAGER, write: Reply = ok({ message: "set" })): Routes =>
  (path, request) => {
    if (path === "/v1/products/api/channels/stable/policy") {
      return request.method === "PUT" ? write : ok(VIEW);
    }
    const recall = /^\/v1\/releases\/([^/]+)\/recall$/.exec(path);
    if (recall) {
      const found = RECALLS[decodeURIComponent(recall[1] ?? "")];
      return found ? ok(found) : { status: 404, body: { error: "not recalled" } };
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

const detail = (page: Page) => page.getByRole("region", { name: "Policy detail" });
const editor = (page: Page) => detail(page).getByRole("group", { name: "Recall rule" });
const recall = (page: Page) => page.getByRole("region", { name: "Recall detail" });

const openReleases = async (page: Page, app: MockBackend) => {
  await page.goto(app.url);
  await page.getByRole("link", { name: "Releases" }).click();
  await expect(page.getByRole("heading", { name: "Promotion policies" })).toBeVisible();
};

const openPolicy = async (page: Page, app: MockBackend) => {
  await openReleases(page, app);
  await page.getByRole("button", { name: "Detail api stable" }).click();
  await expect(detail(page).getByRole("term").first()).toHaveText("Policy");
  await page.waitForLoadState("networkidle");
};

const setRule = async (page: Page, soak: string, failing: string) => {
  await editor(page).getByRole("textbox", { name: "Minimum soak" }).fill(soak);
  await editor(page).getByRole("textbox", { name: "Failing max share" }).fill(failing);
  await editor(page).getByRole("checkbox").check();
  await editor(page).getByRole("button", { name: "Set recall rule" }).click();
};

const puts = (app: MockBackend) => app.sent.filter((sent) => sent.method === "PUT");

const shot = (page: Page, name: string) =>
  page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });

test.describe("recall rule edit", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("sets the rule with one request fenced by the version read, then reads it again", async ({
    page,
  }) => {
    let body: ChannelRecallRuleRequest | undefined;
    let stored: ChannelPromotionPolicyView | undefined;
    app = await serveConsole(server());
    await page.route("**/v1/products/api/channels/stable/policy", async (route) => {
      if (route.request().method() === "PUT") {
        body = route.request().postDataJSON() as ChannelRecallRuleRequest;
        // The server stores the rule at the next version.
        stored = {
          ...VIEW,
          policy_version: 3,
          soak_duration_ms: body.soak_duration_ms,
          evidence: {
            ...VIEW.evidence,
            failing_max_share: body.failing_max_share,
            recall_on_failing: body.recall_on_failing,
          },
        };
        await route.fulfill({ json: { message: "set" } });
        return;
      }
      await route.fulfill({ json: stored ?? VIEW });
    });
    await openPolicy(page, app);
    await expect(editor(page).getByRole("textbox", { name: "Minimum soak" })).toHaveValue("1h");
    await expect(editor(page).getByRole("textbox", { name: "Failing max share" })).toHaveValue(
      "0.05",
    );
    await shot(page, "rule-edit");
    await setRule(page, "90m", "0.1");
    await editor(page)
      .getByRole("button", { name: "Set api stable v2: soak 90m, recall when failing > 0.1" })
      .click();
    await expect(editor(page).getByRole("status")).toHaveText("Recall rule set and audited.");
    expect(body).toEqual({
      version: 1,
      operation: "channel_configure",
      expected_generation: 2,
      soak_duration_ms: 5_400_000,
      failing_max_share: 0.1,
      recall_on_failing: true,
    });
    // Re-read after success: the new version and rule replace the old.
    await expect(detail(page).getByRole("definition").first()).toHaveText(
      "channel-promotion-policy:api/stable v3",
    );
    await expect(detail(page).getByRole("definition").nth(3)).toHaveText(
      "when failing > 10% of 1h soak",
    );
    await expect(editor(page).getByRole("textbox", { name: "Minimum soak" })).toHaveValue("90m");
    await shot(page, "rule-set");
    await expectDesignRules(page);
  });

  test("a stale version is refused, not merged, and offers a reload", async ({ page }) => {
    app = await serveConsole(
      server(MANAGER, { status: 409, body: { error: "expected generation 2 at store.rs:9" } }),
    );
    await openPolicy(page, app);
    await setRule(page, "2h", "0.2");
    await editor(page)
      .getByRole("button", { name: /^Set api stable v2/ })
      .click();
    await expect(editor(page).getByRole("alert")).toHaveText(
      "The policy changed since you read it. Nothing was set; reload and check it.",
    );
    await expect(editor(page).getByRole("button", { name: "Reload" })).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(puts(app)).toHaveLength(1);
    await expect(page.locator("body")).not.toContainText("store.rs");
    await shot(page, "rule-stale");
    await expectDesignRules(page);
  });

  test("a lost response reads as unknown and is sent once", async ({ page }) => {
    app = await serveConsole(server());
    let attempts = 0;
    await page.route("**/v1/products/api/channels/stable/policy", async (route) => {
      if (route.request().method() === "PUT") {
        attempts += 1;
        await route.abort("connectionreset");
        return;
      }
      await route.fallback();
    });
    await openPolicy(page, app);
    await setRule(page, "1h", "0.05");
    await editor(page)
      .getByRole("button", { name: /^Set api stable v2/ })
      .click();
    await expect(editor(page).getByRole("status")).toHaveText(/outcome is unknown/);
    await page.waitForLoadState("networkidle");
    expect(attempts).toBe(1);
    await expect(editor(page).getByRole("status")).not.toHaveText(/audited/);
    await shot(page, "rule-lost");
    await expectDesignRules(page);
  });

  test("an older server says the edit is unavailable", async ({ page }) => {
    app = await serveConsole(server(MANAGER, { status: 405, body: { error: "method" } }));
    await openPolicy(page, app);
    await setRule(page, "1h", "0.05");
    await editor(page)
      .getByRole("button", { name: /^Set api stable v2/ })
      .click();
    await expect(editor(page).getByRole("alert")).toHaveText(
      "This server cannot edit the recall rule.",
    );
    await expectDesignRules(page);
  });

  test("a share outside 0 to 1 cannot be sent", async ({ page }) => {
    app = await serveConsole(server());
    await openPolicy(page, app);
    await editor(page).getByRole("textbox", { name: "Failing max share" }).fill("5");
    await expect(editor(page).getByRole("button", { name: "Set recall rule" })).toBeDisabled();
    await editor(page).getByRole("textbox", { name: "Failing max share" }).fill("0.5");
    await editor(page).getByRole("textbox", { name: "Minimum soak" }).fill("1.5h");
    await expect(editor(page).getByRole("button", { name: "Set recall rule" })).toBeDisabled();
  });

  test("offers no edit without the permission", async ({ page }) => {
    app = await serveConsole(server(["read"]));
    await openPolicy(page, app);
    await expect(editor(page)).toHaveCount(0);
    await expect(detail(page).getByRole("button")).toHaveCount(0);
    await shot(page, "rule-no-permission");
    await expectDesignRules(page);
  });
});

const facts = (page: Page) => recall(page).getByRole("definition");

const openRecall = async (page: Page, app: MockBackend, release: string) => {
  await openReleases(page, app);
  await page.getByRole("button", { name: `Detail ${release}` }).click();
  await expect(facts(page).first()).toHaveText(release);
  await page.waitForLoadState("networkidle");
};

const progress = (page: Page) =>
  recall(page).getByRole("table", { name: "Removal progress" }).getByRole("row");

test.describe("recall measures and removal counts", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("a policy recall shows the measured shares, the threshold, and done of total", async ({
    page,
  }) => {
    app = await serveConsole(server(["read"]));
    await openRecall(page, app, "api@1.4.0");
    await expect(facts(page)).toHaveText([
      "api@1.4.0",
      "policy channel-promotion-policy:api/stable v2 at 2026-11-14T10:05Z",
      "failing share over threshold",
      "healthy 88% · failing 12%",
      "failing > 5%, exceeded",
      "this release only",
      "in progress, 1 environment left · 3 of 5 instances removed",
    ]);
    await expect(progress(page)).toHaveText([
      "EnvironmentRemovedStill running",
      "lab2 of 2none",
      "prod1 of 3api-b, api-c",
    ]);
    await shot(page, "recall-measured");
    await expectDesignRules(page);
  });

  test("an operator recall has counts and no shares", async ({ page }) => {
    app = await serveConsole(server(["read"]));
    await openRecall(page, app, "billing@2.0.0");
    await expect(facts(page)).toHaveText([
      "billing@2.0.0",
      "oidc:alice",
      "bad migration",
      "this release only",
      "complete, no instance runs it · 1 of 1 instances removed",
    ]);
    await expect(progress(page)).toHaveText(["EnvironmentRemovedStill running", "prod1 of 1none"]);
    await expectDesignRules(page);
  });

  // Recorded before measures: `done` is never counted, so it must not read as 0 of 1.
  test("a policy recall recorded before measures says so instead of a stall", async ({ page }) => {
    app = await serveConsole(server(["read"]));
    await openRecall(page, app, "web@3.0.0");
    await expect(facts(page).nth(2)).toHaveText(
      "not recorded, recalled before this server kept measures",
    );
    await expect(facts(page).last()).toHaveText("in progress, 1 environment left");
    await expect(progress(page)).toHaveText([
      "EnvironmentRemovedStill running",
      "prodnot recordedweb",
    ]);
    await expect(recall(page)).not.toContainText("0 of 1");
    await shot(page, "recall-before-measures");
    await expectDesignRules(page);
  });
});

test.describe("recall rule and measures on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  // The top bar already overflows a phone, so overflow is checked on these sections only.
  test("keeps the editor and the recall inside the viewport", async ({ page }) => {
    app = await serveConsole(server());
    await openPolicy(page, app);
    const box = await detail(page).boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
    await shot(page, "rule-phone");
    await page.getByRole("button", { name: "Detail api@1.4.0" }).click();
    await expect(recall(page).getByRole("table")).toBeVisible();
    const recallBox = await recall(page).boundingBox();
    expect(recallBox && recallBox.x >= 0 && recallBox.x + recallBox.width <= 390).toBe(true);
    await shot(page, "recall-measured-phone");
  });
});
