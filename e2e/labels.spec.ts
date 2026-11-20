// Environment and release labels against a mocked API. Run with `pnpm build && pnpm e2e`.
import { type Page, expect, test } from "@playwright/test";
import type { FleetStatusReport } from "../src/api/tenkai.gen";
import {
  type MockBackend,
  type Reply,
  expectDesignRules,
  openApp,
  serveConsole,
} from "./mock-backend";

const ok = (body: unknown): Reply => ({ status: 200, body });

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
      health_summary: "ok",
      lease_held: true,
      posture: "current",
    },
  ],
  environment_count: 1,
  environments_current: 1,
  environments_behind: 0,
  environments_unhealthy: 0,
  environments_empty: 0,
};

const RESULT = ok({ version: 1, operation: "configure", message: "label set" });

type Fixture = {
  environment?: Reply;
  release?: Reply;
  environmentHistory?: Reply;
  releaseHistory?: Reply;
  capabilities?: string[];
};

/** `environment` and `release` answer the two label reads; writes answer `RESULT`. */
const serve = ({
  environment = ok({}),
  release = ok({}),
  environmentHistory,
  releaseHistory,
  capabilities,
}: Fixture) =>
  serveConsole((path, request) => {
    if (path === "/v1/auth/oidc") {
      return { status: 404, body: { error: "no oidc client" } };
    }
    if (path === "/v1/auth/me") {
      return ok({
        principal: "host:uid:1000",
        kind: "human",
        capabilities: capabilities ?? ["read", "management"],
        user: "alice",
        source: "host",
      });
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
        lease: { held: true, status: "held", generation: 7 },
        latest_plan: null,
        subscriptions: [],
      });
    }
    if (path === "/v1/environments/prod/labels/history") {
      return environmentHistory;
    }
    if (path === "/v1/releases/api/1.2.0/labels/history") {
      return releaseHistory;
    }
    if (path === "/v1/environments/prod/labels") {
      return request.method === "GET" ? environment : RESULT;
    }
    if (path === "/v1/releases/api/1.2.0/labels") {
      return request.method === "GET" ? release : RESULT;
    }
    return undefined;
  });

const writes = (app: MockBackend) => app.sent.filter((sent) => sent.method !== "GET");
const envLabels = (page: Page) => page.getByLabel("Labels configured");
const releaseLabels = (page: Page) => page.getByLabel("Release labels configured");
const history = (page: Page) => page.getByLabel("Label history");
const AT = Date.UTC(2026, 10, 14, 10, 0, 0);
const ISO = new Date(AT).toISOString();
const OLDER = "This server does not report label history.";
const capture = (page: Page, name: string) =>
  page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });

const openEnvironment = async (page: Page, app: MockBackend) => {
  await page.goto(app.url);
  await openApp(page, "Environments");
  await expect(envLabels(page)).not.toHaveText("Loading");
  await page.waitForLoadState("networkidle");
};

const openRelease = async (page: Page, app: MockBackend) => {
  await page.goto(app.url);
  await openApp(page, "Releases");
  await page.getByLabel("Labelled release").fill("api@1.2.0");
  await expect(releaseLabels(page)).not.toHaveText("Loading");
  await page.waitForLoadState("networkidle");
};

/** The Labels section's own Edit: the last one on the environment page. */
const editLabels = (page: Page) => page.getByRole("button", { name: "Edit" }).last().click();

test.describe("environment labels", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("no labels", async ({ page }) => {
    app = await serve({});
    await openEnvironment(page, app);
    await expect(envLabels(page)).toHaveText("none");
    await expect(history(page)).toHaveText(OLDER);
    await capture(page, "environment-empty");
    await expectDesignRules(page);
  });

  test("labels set, and a set sends one PUT with the lease generation", async ({ page }) => {
    app = await serve({ environment: ok({ zone: "b", region: "eu" }) });
    let body: unknown;
    page.on("request", (request) => {
      if (request.method() === "PUT" && request.url().endsWith("/v1/environments/prod/labels")) {
        body = request.postDataJSON();
      }
    });
    await openEnvironment(page, app);
    await expect(envLabels(page)).toHaveText("region=eu · zone=b");
    await editLabels(page);
    await page.getByLabel("Label key").fill("tier");
    await page.getByLabel("Label value").fill("gold");
    await page.getByLabel("Reason", { exact: true }).fill("rollout ring");
    await page.getByRole("button", { name: "Set", exact: true }).click();
    await capture(page, "environment-set");
    await page.getByRole("button", { name: "Set label tier=gold" }).click();
    await expect(page.getByRole("status")).toHaveText("label set");
    expect(writes(app).map((sent) => `${sent.method} ${sent.path}`)).toEqual([
      "PUT /v1/environments/prod/labels",
    ]);
    expect(body).toStrictEqual({
      version: 1,
      operation: "configure",
      environment: "prod",
      expected_generation: 7,
      reason: "rollout ring",
      change: { kind: "set_label", key: "tier", value: "gold" },
    });
    await expectDesignRules(page);
  });

  test("no permission", async ({ page }) => {
    app = await serve({
      environment: { status: 403, body: { error: "forbidden" } },
      environmentHistory: { status: 403, body: { error: "forbidden" } },
    });
    await openEnvironment(page, app);
    await expect(envLabels(page)).toHaveText("No access");
    await expect(history(page)).toHaveText("No access");
    await expect(
      page.getByRole("heading", { name: "Labels" }).locator("..").getByRole("button"),
    ).toHaveCount(0);
    await capture(page, "environment-forbidden");
    await expectDesignRules(page);
  });

  test("a lost response reads as unknown and is not retried", async ({ page }) => {
    app = await serve({ environment: ok({ zone: "b" }) });
    let attempts = 0;
    await page.route("**/v1/environments/prod/labels", async (route) => {
      if (route.request().method() === "GET") {
        await route.fallback();
        return;
      }
      attempts += 1;
      await route.abort("connectionreset");
    });
    await openEnvironment(page, app);
    await editLabels(page);
    await page.getByLabel("Label key").fill("zone");
    await page.getByLabel("Reason", { exact: true }).fill("retired");
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await page.getByRole("button", { name: "Clear label zone" }).click();
    await expect(page.getByRole("status")).toHaveText(/outcome is unknown/);
    await page.waitForLoadState("networkidle");
    expect(attempts).toBe(1);
    await expectDesignRules(page);
  });

  test("actor and time on current labels, mixed with a value set before provenance", async ({
    page,
  }) => {
    app = await serve({
      environment: ok({
        region: { value: "eu", set_by: "alice", set_at: AT },
        zone: { value: "b" },
      }),
      environmentHistory: ok([]),
    });
    await openEnvironment(page, app);
    await expect(envLabels(page)).toHaveText(`region=eu, alice at ${ISO} · zone=b`);
    await expect(history(page)).toHaveText("none");
    await capture(page, "environment-provenance");
    await expectDesignRules(page);
  });

  test("label history lists set and clear with actor, time and reason", async ({ page }) => {
    app = await serve({
      environment: ok({ region: { value: "eu", set_by: "alice", set_at: AT } }),
      environmentHistory: ok([
        {
          id: "1",
          sequence: 1,
          key: "region",
          action: "set",
          actor: "alice",
          at: AT,
          value: "eu",
          reason: "ring",
        },
        {
          id: "2",
          sequence: 2,
          key: "tier",
          action: "clear",
          actor: "bob",
          at: AT + 1_000,
          reason: "retired",
        },
      ]),
    });
    await openEnvironment(page, app);
    const rows = history(page).locator("li");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveText(
      `clear tier by bob at ${new Date(AT + 1_000).toISOString()}: retired`,
    );
    await expect(rows.nth(1)).toHaveText(`set region=eu by alice at ${ISO}: ring`);
    expect(
      app.sent.some(
        (sent) => sent.method === "GET" && sent.path === "/v1/environments/prod/labels/history",
      ),
    ).toBe(true);
    await capture(page, "environment-history");
    await expectDesignRules(page);
  });

  test("a long label history lists every change without overflow", async ({ page }) => {
    const changes = Array.from({ length: 24 }, (_, index) => ({
      id: `c${index}`,
      sequence: index + 1,
      key: "ring",
      action: "set" as const,
      actor: "alice",
      at: AT + index * 1_000,
      value: `n${index}`,
      reason: "rollout",
    }));
    app = await serve({
      environment: ok({ ring: { value: "n23", set_by: "alice", set_at: AT + 23_000 } }),
      environmentHistory: ok(changes),
    });
    await openEnvironment(page, app);
    const rows = history(page).locator("li");
    await expect(rows).toHaveCount(24);
    await expect(rows.first()).toHaveText(
      `set ring=n23 by alice at ${new Date(AT + 23_000).toISOString()}: rollout`,
    );
    await expect(rows.last()).toHaveText(`set ring=n0 by alice at ${ISO}: rollout`);
    await capture(page, "environment-history-long");
    await expectDesignRules(page);
  });
});

test.describe("release labels", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("labels set, and a clear sends one DELETE; the last write wins", async ({ page }) => {
    app = await serve({ release: ok({ tier: "gold" }) });
    let body: unknown;
    page.on("request", (request) => {
      if (request.method() === "DELETE") {
        body = request.postDataJSON();
      }
    });
    await openRelease(page, app);
    await expect(releaseLabels(page)).toHaveText("tier=gold");
    await expect(page.getByText("Last write wins")).toBeVisible();
    await page.getByLabel("Release label key").fill("tier");
    await page.getByLabel("Release label reason").fill("demoted");
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await page.getByRole("button", { name: "Clear api@1.2.0 label tier" }).click();
    await expect(page.getByRole("status")).toHaveText("label set");
    expect(writes(app).map((sent) => `${sent.method} ${sent.path}`)).toEqual([
      "DELETE /v1/releases/api/1.2.0/labels",
    ]);
    expect(body).toStrictEqual({
      version: 1,
      operation: "release_label_clear",
      key: "tier",
      reason: "demoted",
    });
    await capture(page, "release-set");
    await expectDesignRules(page);
  });

  test("no labels", async ({ page }) => {
    app = await serve({});
    await openRelease(page, app);
    await expect(releaseLabels(page)).toHaveText("none");
    await expect(history(page)).toHaveText(OLDER);
    await expectDesignRules(page);
  });

  test("no permission: read-only credentials see labels without an editor", async ({ page }) => {
    app = await serve({ release: ok({ tier: "gold" }), capabilities: ["read"] });
    await openRelease(page, app);
    await expect(releaseLabels(page)).toHaveText("tier=gold");
    await expect(page.getByLabel("Release label key")).toHaveCount(0);
    await capture(page, "release-read-only");
    await expectDesignRules(page);
  });

  test("a lost response reads as unknown and is not retried", async ({ page }) => {
    app = await serve({ release: ok({}) });
    let attempts = 0;
    await page.route("**/v1/releases/api/1.2.0/labels", async (route) => {
      if (route.request().method() === "GET") {
        await route.fallback();
        return;
      }
      attempts += 1;
      await route.abort("connectionreset");
    });
    await openRelease(page, app);
    await page.getByLabel("Release label key").fill("tier");
    await page.getByLabel("Release label value").fill("gold");
    await page.getByLabel("Release label reason").fill("ring");
    await page.getByRole("button", { name: "Set", exact: true }).click();
    await page.getByRole("button", { name: "Set api@1.2.0 label tier=gold" }).click();
    await expect(page.getByRole("status")).toHaveText(/outcome is unknown/);
    await page.waitForLoadState("networkidle");
    expect(attempts).toBe(1);
    await capture(page, "release-unknown");
    await expectDesignRules(page);
  });

  test("actor, time and history on a release, including a value set before provenance", async ({
    page,
  }) => {
    app = await serve({
      release: ok({
        tier: { value: "gold", set_by: "ci", set_at: AT },
        ring: { value: "canary" },
      }),
      releaseHistory: ok([
        {
          id: "r1",
          sequence: 1,
          key: "tier",
          action: "set",
          actor: "ci",
          at: AT,
          value: "gold",
          reason: "promote",
        },
      ]),
    });
    await openRelease(page, app);
    await expect(releaseLabels(page)).toHaveText(`ring=canary · tier=gold, ci at ${ISO}`);
    await expect(history(page).locator("li")).toHaveText(`set tier=gold by ci at ${ISO}: promote`);
    await capture(page, "release-history");
    await expectDesignRules(page);
  });
});

test.describe("labels on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("the labels editor fits the viewport", async ({ page }) => {
    app = await serve({ environment: ok({ region: "eu", zone: "b" }) });
    await openEnvironment(page, app);
    await editLabels(page);
    await expect(page.getByLabel("Label key")).toBeVisible();
    await capture(page, "environment-phone");
    // The top navigation overflows a phone on every screen today; hold the
    // labels editor to the viewport and the copy rules.
    const box = await page.getByLabel("Label key").locator("..").boundingBox();
    expect((box?.x ?? 0) + (box?.width ?? Infinity)).toBeLessThanOrEqual(390);
    expect(await page.locator("body").textContent()).not.toMatch(
      /\bADR\b|#\d+|HTTP \d{3}|\/v1\/|\bat \w+ \(|Error:|—/,
    );
  });

  test("provenance and a long history fit the viewport", async ({ page }) => {
    const changes = Array.from({ length: 12 }, (_, index) => ({
      id: `p${index}`,
      sequence: index + 1,
      key: "region",
      action: "set" as const,
      actor: "alice",
      at: AT + index * 1_000,
      value: "eu",
      reason: "ring",
    }));
    app = await serve({
      environment: ok({
        region: { value: "eu", set_by: "alice", set_at: AT + 11_000 },
      }),
      environmentHistory: ok(changes),
    });
    await openEnvironment(page, app);
    await expect(history(page).locator("li")).toHaveCount(12);
    await capture(page, "environment-history-phone");
    await expectDesignRules(page);
  });
});
