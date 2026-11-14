// Recall detail on Releases against a mocked API. Run with `pnpm build && pnpm e2e`.
import { type Page, expect, test } from "@playwright/test";
import type { ChangeEvent, FleetStatusReport, RecallView } from "../src/api/tenkai.gen";
import {
  type MockBackend,
  type Reply,
  type Routes,
  expectDesignRules,
  serveConsole,
} from "./mock-backend";

const FLEET: FleetStatusReport = {
  environments: [],
  environment_count: 0,
  environments_current: 0,
  environments_behind: 0,
  environments_unhealthy: 0,
  environments_empty: 0,
};

const ok = (body: unknown): Reply => ({ status: 200, body });

const event = (cursor: number, resource: string): ChangeEvent => ({
  cursor: String(cursor),
  occurred_at: Date.UTC(2026, 10, 14, 9, cursor),
  kind: "release_recalled",
  resource,
});

const removal = (environment: string, instance: string) => ({
  environment,
  instance,
  deployed: "api@1.4.0",
  remaining: true,
});

// A health-triggered recall still rolling off, and an operator recall that is done.
const RECALLS: Record<string, Reply> = {
  "api@1.4.0": ok({
    release: "api@1.4.0",
    recalled_at: Date.UTC(2026, 10, 14, 10, 5),
    recalled_by: "channel-promotion-policy",
    principal_kind: "channel_promotion_policy",
    policy_id: "tenkai:channel-promotion-policy:api/stable:3",
    policy_version: "3",
    reason: "failing share 0.120 > 0.050; healthy share 0.880",
    failing_instances: ["edge-1 (http: 503 on /ready)", "edge-2 (disk: 97% used)"],
    range: "api [1.4.0, ∞)",
    covers_future: true,
    removal_progress: [removal("edge", "api-1"), removal("edge", "api-2"), removal("stage", "api")],
  } satisfies RecallView),
  "billing@2.0.0": ok({
    release: "billing@2.0.0",
    recalled_at: Date.UTC(2026, 10, 13, 8, 0),
    recalled_by: "oidc:alice",
    principal_kind: "human",
    reason: "bad migration",
    range: "billing [2.0.0, 2.0.1)",
    covers_future: false,
  } satisfies RecallView),
  "web@3.0.0": { status: 403, body: { error: "missing environment grant for recall" } },
};

const RECALL = /^\/v1\/releases\/(?<release>[^/]+)\/recall$/;

const server =
  (
    events: ChangeEvent[],
    recall: (release: string) => Reply | undefined = (r) => RECALLS[r],
  ): Routes =>
  (path) => {
    const route = RECALL.exec(path);
    if (route) {
      return recall(decodeURIComponent(route.groups?.release ?? ""));
    }
    if (path === "/v1/auth/oidc") {
      return { status: 404, body: { error: "no oidc client" } };
    }
    if (path === "/v1/auth/me") {
      return ok({
        principal: "host:uid:1000",
        kind: "human",
        capabilities: ["read"],
        user: "alice",
        groups: ["tenkai-viewer"],
        source: "host",
      });
    }
    if (path === "/v1/fleet/status") {
      return ok(FLEET);
    }
    if (path === "/v1/events") {
      return ok({ events, next_cursor: String(events.length) });
    }
    if (path === "/v1/environments") {
      return ok([]);
    }
    if (path === "/v1/channels") {
      return ok({ items: [] });
    }
    return undefined;
  };

const EVENTS = [
  event(1, "billing@2.0.0"),
  event(2, "web@3.0.0"),
  event(3, "api@1.4.0"),
  event(4, "api@1.4.0"),
];

const detail = (page: Page) => page.getByRole("region", { name: "Recall detail" });
const facts = (page: Page) => detail(page).getByRole("definition");

const openReleases = async (page: Page, app: MockBackend) => {
  await page.goto(app.url);
  await page.getByRole("link", { name: "Releases" }).click();
  await expect(page.getByRole("heading", { name: "Recall follow-through" })).toBeVisible();
};

const openRecall = async (page: Page, release: string) => {
  await page.getByRole("button", { name: `Detail ${release}` }).click();
  await page.waitForLoadState("networkidle");
};

const shot = (page: Page, name: string) =>
  page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });

test.describe("recall detail", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("says when there is no recall", async ({ page }) => {
    app = await serveConsole(server([]));
    await openReleases(page, app);
    await expect(page.getByText("No recalls.")).toBeVisible();
    await expect(page.getByRole("list", { name: "Recalled releases" })).toHaveCount(0);
    await shot(page, "recall-none");
    await expectDesignRules(page);
  });

  test("a policy recall names the policy, marks the open range, and shows removal", async ({
    page,
  }) => {
    app = await serveConsole(server(EVENTS));
    await openReleases(page, app);
    await expect(
      page.getByRole("list", { name: "Recalled releases" }).getByRole("listitem"),
    ).toHaveText(["api@1.4.0", "web@3.0.0", "billing@2.0.0"]);
    await openRecall(page, "api@1.4.0");
    await expect(facts(page)).toHaveText([
      "api@1.4.0",
      "policy tenkai:channel-promotion-policy:api/stable:3 v3 at 2026-11-14T10:05Z",
      "failing share 0.120 > 0.050; healthy share 0.880",
      "edge-1 (http: 503 on /ready)edge-2 (disk: 97% used)",
      "api [1.4.0, ∞) · open, covers future releases",
      "in progress, 2 environments left",
    ]);
    await expect(
      detail(page).getByRole("list", { name: "Failing instances" }).getByRole("listitem"),
    ).toHaveText(["edge-1 (http: 503 on /ready)", "edge-2 (disk: 97% used)"]);
    const progress = detail(page).getByRole("table", { name: "Removal progress" });
    await expect(progress.getByRole("row")).toHaveText([
      "EnvironmentStill running",
      "edgeapi-1, api-2",
      "stageapi",
    ]);
    await shot(page, "recall-in-progress");
    await expectDesignRules(page);
    // Read-only: nothing but reads.
    expect(app.sent.every((sent) => sent.method === "GET")).toBe(true);
  });

  test("an operator recall with nothing left reads complete", async ({ page }) => {
    app = await serveConsole(server(EVENTS));
    await openReleases(page, app);
    await openRecall(page, "billing@2.0.0");
    await expect(facts(page)).toHaveText([
      "billing@2.0.0",
      "oidc:alice at 2026-11-13T08:00Z",
      "bad migration",
      "billing [2.0.0, 2.0.1) · closed",
      "complete, no instance runs it",
    ]);
    await expect(detail(page).getByRole("table")).toHaveCount(0);
    await shot(page, "recall-complete");
    await expectDesignRules(page);
  });

  test("no permission hides the server's text", async ({ page }) => {
    app = await serveConsole(server(EVENTS));
    await openReleases(page, app);
    await openRecall(page, "web@3.0.0");
    await expect(detail(page)).toHaveText("No access");
    await expect(page.locator("body")).not.toContainText("environment grant");
    await shot(page, "recall-no-permission");
    await expectDesignRules(page);
  });

  test("an older server says it does not report recall detail", async ({ page }) => {
    app = await serveConsole(server(EVENTS, () => ({ status: 405, body: { error: "method" } })));
    await openReleases(page, app);
    await openRecall(page, "api@1.4.0");
    await expect(detail(page)).toHaveText("This server does not report recall detail.");
    await expectDesignRules(page);
  });
});

test.describe("recall detail on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  // The top bar already overflows a phone, so overflow is checked on this section only.
  test("keeps the detail inside the viewport", async ({ page }) => {
    app = await serveConsole(server(EVENTS));
    await openReleases(page, app);
    await openRecall(page, "api@1.4.0");
    await expect(detail(page).getByRole("table")).toBeVisible();
    const box = await detail(page).boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
    await shot(page, "recall-phone");
    expect(await page.locator("body").textContent()).not.toMatch(
      /\bADR\b|#\d+|HTTP \d{3}|\/v1\/|\bat \w+ \(|Error:|—/,
    );
  });
});
