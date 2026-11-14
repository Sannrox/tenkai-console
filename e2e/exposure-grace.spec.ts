// Waiver list and exposure grace against a mocked API. Run with `pnpm build && pnpm e2e`.
import { type Page, expect, test } from "@playwright/test";
import type {
  AdvisoryFeedStatus,
  EnvironmentInspectReport,
  ExposureWaiver,
  FleetStatusReport,
  MatchedExposure,
} from "../src/api/tenkai.gen";
import { type MockBackend, type Reply, expectDesignRules, serveConsole } from "./mock-backend";

const DAY = 86_400_000;
const SHOTS = "/tmp/lane-164";

const MATCH: MatchedExposure = {
  advisory_id: "TENKAI-2026-1",
  severity: "high",
  component: "openssl",
  component_version: "1.1.1",
  release: "api@1.0.0",
  release_id: "tenkai:release:api@1.0.0",
};

const waiver = (overrides: Partial<ExposureWaiver>): ExposureWaiver => ({
  advisory_id: "TENKAI-2026-1",
  scope: "release",
  category: "mitigated",
  reason: "patched in sidecar",
  actor: "alice",
  expires_at: Date.now() + 30 * DAY,
  ...overrides,
});

// Active on a finding, expiring soon with no current match, and one expired.
const ACTIVE = waiver({ release_id: "tenkai:release:api@1.0.0" });
const UNMATCHED = waiver({
  advisory_id: "TENKAI-2026-9",
  scope: "component",
  component: "zlib",
  category: "upstream_dependency",
  reason: "fix lands with the next base image",
  actor: "bob",
  expires_at: Date.now() + 2 * DAY,
});
const EXPIRED = waiver({
  advisory_id: "TENKAI-2026-2",
  scope: "product",
  product: "api",
  category: "false_positive",
  reason: "scanner noise",
  expires_at: Date.now() - DAY,
});

const feed = (matches: MatchedExposure[]): AdvisoryFeedStatus => ({
  imported: true,
  imported_at: Date.UTC(2026, 10, 1),
  generated_at: Date.UTC(2026, 10, 1),
  age_ms: DAY,
  advisory_count: 2,
  matches,
});

const ok = (body: unknown): Reply => ({ status: 200, body });

const ME = ok({
  principal: "host:uid:1000",
  kind: "human",
  capabilities: ["read"],
  user: "alice",
  source: "host",
});

type Options = {
  matches?: MatchedExposure[];
  /** Replaces the waiver list answer, for an older server or a refusal. */
  list?: Reply;
};

/** A server that lists expired waivers only when asked, as Tenkai does. */
const serve = ({ matches = [MATCH], list }: Options = {}) =>
  serveConsole((path, request) => {
    if (path === "/v1/auth/oidc") {
      return { status: 404, body: { error: "no oidc client" } };
    }
    if (path === "/v1/auth/me") {
      return ME;
    }
    if (path === "/v1/advisory-feed") {
      return ok(feed(matches));
    }
    if (path === "/v1/exposures/waivers" && request.method === "GET") {
      const expired = new URL(request.url ?? "", "http://local").searchParams.has(
        "include_expired",
      );
      return list ?? ok({ waivers: expired ? [ACTIVE, UNMATCHED, EXPIRED] : [ACTIVE, UNMATCHED] });
    }
    return undefined;
  });

const waivers = (page: Page) => page.getByRole("table", { name: "Waivers" });
const findings = (page: Page) => page.getByRole("table", { name: "Findings" });
const section = (page: Page) => page.getByRole("region", { name: "Waivers" });
const shot = (page: Page, name: string) =>
  page.screenshot({ path: `${SHOTS}/${process.pid}-${name}.png`, fullPage: true });

const open = async (page: Page, app: MockBackend) => {
  await page.goto(app.url);
  await page.getByRole("link", { name: "Exposure" }).click();
  await expect(findings(page)).toBeVisible();
};

test.describe("waiver list and grace", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("lists active waivers, including one with no current match", async ({ page }) => {
    app = await serve({ matches: [{ ...MATCH, waiver: ACTIVE }] });
    await open(page, app);
    const rows = waivers(page).getByRole("row");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(1)).toContainText("TENKAI-2026-9");
    await expect(rows.nth(1)).toContainText("component zlib");
    await expect(rows.nth(1)).toContainText("upstream dependency");
    await expect(rows.nth(1)).toContainText("fix lands with the next base image");
    await expect(rows.nth(1)).toContainText("bob");
    await expect(rows.nth(1).getByRole("cell").last()).toHaveText(/^expiring soon · \d{4}-/);
    await expect(rows.nth(2).getByRole("cell").last()).toHaveText(/^\d{4}-\d\d-\d\dT\d\d:\d\dZ$/);
    await expect(waivers(page).getByText("TENKAI-2026-2")).toHaveCount(0);
    expect(
      app.sent.filter((sent) => sent.path === "/v1/exposures/waivers").map((sent) => sent.search),
    ).toEqual([""]);
    await shot(page, "waivers-active");
    await expectDesignRules(page);
  });

  test("an expired waiver is listed only when asked and no longer marks its finding", async ({
    page,
  }) => {
    app = await serve({ matches: [{ ...MATCH, advisory_id: "TENKAI-2026-2", waiver: EXPIRED }] });
    await open(page, app);
    await expect(findings(page).getByRole("cell", { name: "none", exact: true })).toBeVisible();
    await expect(waivers(page).getByText("TENKAI-2026-2")).toHaveCount(0);
    await section(page).getByLabel("Include expired").check();
    const row = waivers(page).getByRole("row").filter({ hasText: "TENKAI-2026-2" });
    await expect(row.getByRole("cell").last()).toHaveText(/^expired · \d{4}-/);
    await expect(row).toContainText("product api");
    await expect(findings(page).getByRole("cell", { name: "none", exact: true })).toBeVisible();
    expect(
      app.sent.filter((sent) => sent.path === "/v1/exposures/waivers").map((sent) => sent.search),
    ).toEqual(["", "?include_expired=true"]);
    await shot(page, "waivers-expired");
    await expectDesignRules(page);
  });

  test("a finding within grace shows the server's grace end per environment", async ({ page }) => {
    const end = Date.UTC(2026, 10, 20, 10, 30);
    app = await serve({
      matches: [
        {
          ...MATCH,
          grace: [
            { environment: "prod", grace_ends_at: end, in_grace: true },
            { environment: "stage", grace_ends_at: Date.UTC(2026, 10, 1), in_grace: false },
          ],
        },
        { ...MATCH, release: "api@2.0.0", release_id: "tenkai:release:api@2.0.0" },
      ],
    });
    await open(page, app);
    const rows = findings(page).getByRole("row");
    await expect(rows.nth(1)).toContainText("prod until 2026-11-20T10:30Z");
    await expect(rows.nth(1)).not.toContainText("stage");
    await expect(rows.nth(2).getByRole("cell").nth(4)).toHaveText("·");
    await shot(page, "findings-grace");
    await expectDesignRules(page);
  });

  test("an older server without the list says so", async ({ page }) => {
    app = await serve({ list: { status: 405, body: { error: "method not allowed" } } });
    await open(page, app);
    await expect(section(page)).toContainText("This server does not list waivers.");
    await expect(waivers(page)).toHaveCount(0);
    await expectDesignRules(page);
  });

  test("a credential without access sees no list", async ({ page }) => {
    app = await serve({ list: { status: 403, body: { error: "read capability required" } } });
    await open(page, app);
    await expect(section(page)).toContainText("No access");
    await expect(section(page)).not.toContainText("read capability required");
    await expect(waivers(page)).toHaveCount(0);
    await expectDesignRules(page);
  });
});

test.describe("waiver list on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("the list stays inside the viewport", async ({ page }) => {
    app = await serve();
    await open(page, app);
    await section(page).getByLabel("Include expired").check();
    await expect(waivers(page).getByRole("row")).toHaveCount(4);
    const box = await section(page).boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
    await shot(page, "waivers-phone");
    // The top navigation's own phone overflow predates this screen, so only text rules apply here.
    expect(await page.locator("body").textContent()).not.toMatch(
      /\bADR\b|#\d+|HTTP \d{3}|\/v1\/|\bat \w+ \(|Error:|—/,
    );
  });
});

const FLEET: FleetStatusReport = {
  environments: [
    {
      id: "env:prod",
      name: "prod",
      description: "fixture",
      subscription_count: 0,
      products_current: 0,
      products_behind: 0,
      products_missing: 0,
      unhealthy: false,
      health_summary: "n/a",
      lease_held: false,
      posture: "empty",
    },
  ],
  environment_count: 1,
  environments_current: 0,
  environments_behind: 0,
  environments_unhealthy: 0,
  environments_empty: 1,
};

const environment = (grace: number | undefined) =>
  serveConsole((path) => {
    if (path === "/v1/auth/oidc") {
      return { status: 404, body: { error: "no oidc client" } };
    }
    if (path === "/v1/auth/me") {
      return ME;
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
        lease: { held: false, generation: 1, status: "free" },
        latest_plan: null,
        subscriptions: [],
        ...(grace === undefined ? {} : { exposure_grace_ms: grace }),
      } as unknown as EnvironmentInspectReport);
    }
    return undefined;
  });

test.describe("environment exposure grace", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  for (const [grace, text] of [
    [3 * DAY, "3d"],
    [undefined, "not set"],
  ] as const) {
    test(`shows a ${text} grace window read-only`, async ({ page }) => {
      app = await environment(grace);
      await page.goto(app.url);
      await page.getByRole("link", { name: "Environments" }).click();
      await expect(page.getByLabel("Exposure grace configured")).toHaveText(text);
      await shot(page, `environment-grace-${text.replace(" ", "-")}`);
      await expectDesignRules(page);
    });
  }
});
