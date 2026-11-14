// Advisory waivers on exposure findings against a mocked API. Run with `pnpm build && pnpm e2e`.
import { type Page, expect, test } from "@playwright/test";
import type { AdvisoryFeedStatus, ExposureWaiver, MatchedExposure } from "../src/api/tenkai.gen";
import { type MockBackend, type Reply, expectDesignRules, serveConsole } from "./mock-backend";

const DAY = 86_400_000;

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
  release_id: "tenkai:release:api@1.0.0",
  category: "mitigated",
  reason: "patched in sidecar",
  actor: "alice",
  expires_at: Date.now() + 30 * DAY,
  ...overrides,
});

const feed = (matches: MatchedExposure[]): AdvisoryFeedStatus => ({
  imported: true,
  imported_at: Date.UTC(2026, 10, 1),
  generated_at: Date.UTC(2026, 10, 1),
  age_ms: DAY,
  advisory_count: 1,
  matches,
});

const ok = (body: unknown): Reply => ({ status: 200, body });

const serve = (
  matches: MatchedExposure[],
  capabilities = ["read", "management"],
  write: Reply = ok({ version: 1, operation: "waiver_set", message: "waived TENKAI-2026-1" }),
) =>
  serveConsole((path, request) => {
    if (path === "/v1/auth/oidc") {
      return { status: 404, body: { error: "no oidc client" } };
    }
    if (path === "/v1/auth/me") {
      return ok({
        principal: "host:uid:1000",
        kind: "human",
        capabilities,
        user: "alice",
        source: "host",
      });
    }
    if (path === "/v1/advisory-feed") {
      return ok(feed(matches));
    }
    if (path.startsWith("/v1/exposures/waivers") && request.method === "POST") {
      return write;
    }
    return undefined;
  });

const findings = (page: Page) => page.getByRole("table", { name: "Findings" });

const open = async (page: Page, app: MockBackend) => {
  await page.goto(app.url);
  const loaded = page.waitForResponse((response) => response.url().endsWith("/v1/advisory-feed"));
  await page.getByRole("link", { name: "Exposure" }).click();
  await loaded;
  await expect(findings(page)).toBeVisible();
};

const posts = (app: MockBackend) => app.sent.filter((sent) => sent.method === "POST");

test.describe("exposure waivers", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("no waivers offers a waive affordance", async ({ page }) => {
    app = await serve([MATCH]);
    await open(page, app);
    await expect(findings(page).getByRole("cell", { name: "none", exact: true })).toBeVisible();
    await expect(findings(page).getByRole("button", { name: "Waive" })).toBeVisible();
    await expectDesignRules(page);
  });

  test("an active waiver shows scope, category, reason, actor and expiry", async ({ page }) => {
    app = await serve([{ ...MATCH, waiver: waiver({}) }]);
    await open(page, app);
    const table = findings(page);
    await expect(
      table.getByText(/release tenkai:release:api@1\.0\.0 · mitigated · until .* · by alice/),
    ).toBeVisible();
    await expect(table.getByText("patched in sidecar")).toBeVisible();
    await expect(table.getByText("expiring soon")).toHaveCount(0);
    await expect(table.getByRole("button", { name: "Remove" })).toBeVisible();
    await expectDesignRules(page);
  });

  test("a waiver ending within a week is highlighted", async ({ page }) => {
    app = await serve([{ ...MATCH, waiver: waiver({ expires_at: Date.now() + 2 * DAY }) }]);
    await open(page, app);
    await expect(findings(page).getByText(/^expiring soon · release/)).toBeVisible();
    await expectDesignRules(page);
  });

  test("an expired waiver no longer marks its finding", async ({ page }) => {
    app = await serve([{ ...MATCH, waiver: waiver({ expires_at: Date.now() - DAY }) }]);
    await open(page, app);
    await expect(findings(page).getByRole("cell", { name: "none", exact: true })).toBeVisible();
    await expect(findings(page).getByRole("button", { name: "Waive" })).toBeVisible();
  });

  test("without management there is no create or remove affordance", async ({ page }) => {
    app = await serve(
      [
        MATCH,
        {
          ...MATCH,
          release: "api@2.0.0",
          release_id: "tenkai:release:api@2.0.0",
          waiver: waiver({}),
        },
      ],
      ["read"],
    );
    await open(page, app);
    await expect(findings(page).getByText("patched in sidecar")).toBeVisible();
    await expect(page.getByRole("button", { name: /^(Waive|Remove)$/ })).toHaveCount(0);
    await expectDesignRules(page);
  });

  test("a global waiver needs an explicit acknowledgement before it is sent", async ({ page }) => {
    app = await serve([MATCH]);
    await open(page, app);
    await findings(page).getByRole("button", { name: "Waive" }).click();
    await page.getByLabel("Waiver scope").selectOption("global");
    await page.getByLabel("Waiver reason").fill("scanner noise");
    const waive = page.getByRole("button", { name: "Waive", exact: true }).last();
    await expect(waive).toBeDisabled();
    await page.getByLabel("Applies to every product").check();
    await waive.click();
    await page
      .getByRole("button", { name: "Waive TENKAI-2026-1 for every product until 7d" })
      .click();
    await expect(page.getByRole("status")).toHaveText("waived TENKAI-2026-1");
    expect(posts(app).map((sent) => sent.path)).toEqual(["/v1/exposures/waivers"]);
    await expectDesignRules(page);
  });

  test("remove sends one clear for the waiver's own scope", async ({ page }) => {
    app = await serve([{ ...MATCH, waiver: waiver({}) }]);
    let body: unknown;
    page.on("request", (request) => {
      if (request.url().endsWith("/v1/exposures/waivers/clear")) {
        body = request.postDataJSON();
      }
    });
    await open(page, app);
    await findings(page).getByRole("button", { name: "Remove" }).click();
    await page.getByLabel("Removal reason").fill("fixed");
    await page.getByRole("button", { name: "Remove waiver" }).click();
    await page.getByRole("button", { name: "Remove release waiver on TENKAI-2026-1" }).click();
    await expect(page.getByRole("status")).toHaveText("waived TENKAI-2026-1");
    expect(posts(app).map((sent) => sent.path)).toEqual(["/v1/exposures/waivers/clear"]);
    expect(body).toMatchObject({
      operation: "waiver_clear",
      scope: "release",
      release_id: "tenkai:release:api@1.0.0",
      reason: "fixed",
    });
  });

  test("a lost response reads as unknown and is not retried", async ({ page }) => {
    app = await serve([MATCH]);
    let attempts = 0;
    await page.route("**/v1/exposures/waivers", async (route) => {
      // The waiver list reads the same path; only the write is lost.
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }
      attempts += 1;
      await route.abort("connectionreset");
    });
    await open(page, app);
    await findings(page).getByRole("button", { name: "Waive" }).click();
    await page.getByLabel("Waiver reason").fill("scanner noise");
    await page.getByRole("button", { name: "Waive", exact: true }).last().click();
    await page.getByRole("button", { name: /^Waive TENKAI-2026-1 for release/ }).click();
    await expect(page.getByRole("status")).toHaveText(/outcome is unknown/);
    await page.waitForLoadState("networkidle");
    expect(attempts).toBe(1);
    await expectDesignRules(page);
  });

  test("a credential refusal hides the controls", async ({ page }) => {
    app = await serve([MATCH], ["read", "management"], {
      status: 403,
      body: { error: "environment-scoped credentials cannot change catalog-wide waivers" },
    });
    await open(page, app);
    await findings(page).getByRole("button", { name: "Waive" }).click();
    await page.getByLabel("Waiver reason").fill("scanner noise");
    await page.getByRole("button", { name: "Waive", exact: true }).last().click();
    await page.getByRole("button", { name: /^Waive TENKAI-2026-1 for release/ }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("button", { name: /^(Waive|Remove)$/ })).toHaveCount(0);
  });
});

test.describe("exposure waivers on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("findings stay inside the viewport and leak no internals", async ({ page }) => {
    app = await serve([
      MATCH,
      {
        ...MATCH,
        release: "api@2.0.0",
        release_id: "tenkai:release:api@2.0.0",
        waiver: waiver({ expires_at: Date.now() + DAY }),
      },
    ]);
    await open(page, app);
    await findings(page).getByRole("button", { name: "Waive" }).click();
    await page.getByLabel("Waiver scope").selectOption("global");
    const box = await page.getByRole("region", { name: "Findings" }).boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
    expect(await page.locator("body").textContent()).not.toMatch(
      /\bADR\b|#\d+|HTTP \d{3}|\/v1\/|\bat \w+ \(|Error:|—/,
    );
  });
});
