// Channel promotion policy status on Releases against a mocked API. Run with `pnpm build && pnpm e2e`.
import { type Page, expect, test } from "@playwright/test";
import type { ChannelPromotionPolicyStatus, FleetStatusReport } from "../src/api/tenkai.gen";
import {
  HEALTHZ,
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

const policy = (
  product: string,
  source: string,
  target: string,
  patch: Partial<ChannelPromotionPolicyStatus>,
): ChannelPromotionPolicyStatus => ({
  product,
  source_channel: source,
  target_channel: target,
  policy_id: `channel-promotion-policy:${product}/${target}`,
  policy_version: 2,
  paused: false,
  state: "soaking",
  ...patch,
});

// One row per listed state: soak in progress, evidence missing, paused, promoted, reset.
const POLICIES: ChannelPromotionPolicyStatus[] = [
  policy("api", "dev", "candidate", {}),
  policy("api", "candidate", "stable", {
    state: "waiting",
    reason: "instances without health evidence",
    instances_without_evidence: ["edge-1", "edge-2"],
  }),
  policy("billing", "candidate", "stable", { paused: true, state: "waiting", reason: "paused" }),
  policy("web", "dev", "candidate", { state: "promoted" }),
  policy("web", "candidate", "stable", {
    state: "reset",
    reason: "health evidence failed on edge-3",
  }),
];

const CAPABLE: Reply = {
  status: 200,
  body: {
    status: "ok",
    profile: "fixture",
    capabilities: ["channel_promotion_policy:v1"],
    contracts: ["tenkai.http.v1"],
  },
};

const ok = (body: unknown): Reply => ({ status: 200, body });

const server =
  (fleet: FleetStatusReport, healthz: Reply = CAPABLE): Routes =>
  (path) => {
    if (path === "/healthz") {
      return healthz;
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
      return ok(fleet);
    }
    if (path === "/v1/environments" || path === "/v1/events") {
      return ok(path === "/v1/events" ? { events: [], next_cursor: "0" } : []);
    }
    if (path === "/v1/channels") {
      return ok({ items: [] });
    }
    return undefined;
  };

const section = (page: Page) => page.getByRole("region", { name: "Promotion policies" });
const row = (page: Page, text: RegExp) => section(page).getByRole("row").filter({ hasText: text });

const openReleases = async (page: Page, app: MockBackend) => {
  await page.goto(app.url);
  await page.getByRole("link", { name: "Releases" }).click();
  await expect(page.getByRole("heading", { name: "Promotion policies" })).toBeVisible();
};

test.describe("promotion policies", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("lists each policy, its reason, and instances without evidence", async ({ page }) => {
    app = await serveConsole(server({ ...FLEET, promotion_policies: POLICIES }));
    await openReleases(page, app);
    await expect(section(page).getByRole("row")).toHaveCount(POLICIES.length + 1);

    await expect(row(page, /dev -> candidate.*soaking/).first()).toContainText(
      "channel-promotion-policy:api/candidate v2",
    );
    const missing = row(page, /^api.*candidate -> stable/);
    await expect(missing).toContainText("instances without health evidence");
    await expect(
      missing.getByRole("list", { name: "Instances without evidence" }).getByRole("listitem"),
    ).toHaveText(["edge-1", "edge-2"]);
    await expect(row(page, /^billing/)).toContainText("paused");
    await expect(row(page, /^web.*dev -> candidate/)).toContainText("promoted");
    const reset = row(page, /^web.*candidate -> stable/);
    await expect(reset.getByRole("cell", { name: "reset", exact: true })).toBeVisible();
    await expect(
      reset.getByRole("cell", { name: "health evidence failed on edge-3", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath("promotion-policies.png"),
      fullPage: true,
    });
    await expectDesignRules(page);
    // Read-only: nothing but reads, and none of them to a policy route.
    expect(app.sent.every((sent) => sent.method === "GET")).toBe(true);
  });

  test("says when there is no policy", async ({ page }) => {
    app = await serveConsole(server(FLEET));
    await openReleases(page, app);
    await expect(section(page)).toContainText("No promotion policies.");
    await expect(section(page).getByRole("table")).toHaveCount(0);
    await expectDesignRules(page);
  });

  test("says an older server does not report policies", async ({ page }) => {
    app = await serveConsole(server(FLEET, HEALTHZ));
    await openReleases(page, app);
    await expect(section(page)).toContainText("This server does not report promotion policies.");
    await page.screenshot({
      path: test.info().outputPath("promotion-policies-older-server.png"),
      fullPage: true,
    });
    await expectDesignRules(page);
  });
});

test.describe("promotion policies on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  // The top bar already overflows a phone, so overflow is checked on this section only.
  test("keeps the section inside the viewport without leaking internals", async ({ page }) => {
    app = await serveConsole(server({ ...FLEET, promotion_policies: POLICIES }));
    await openReleases(page, app);
    await expect(row(page, /^billing/)).toBeVisible();
    const box = await section(page).boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
    await page.screenshot({
      path: test.info().outputPath("promotion-policies-phone.png"),
      fullPage: true,
    });
    expect(await page.locator("body").textContent()).not.toMatch(
      /\bADR\b|#\d+|HTTP \d{3}|\/v1\/|\bat \w+ \(|Error:|—/,
    );
  });
});
