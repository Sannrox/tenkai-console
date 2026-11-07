// Compatibility profile v2 on Releases (#103). Run with `pnpm build && pnpm e2e`.
import { expect, test } from "@playwright/test";
import type { FleetStatusReport } from "../src/api/tenkai.gen";
import {
  type MockBackend,
  type Reply,
  type Routes,
  expectDesignRules,
  serveConsole,
} from "./mock-backend";

const env = (name: string) => ({
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
  posture: "current" as const,
});

const FLEET: FleetStatusReport = {
  environments: [env("prod"), env("edge-1")],
  environment_count: 2,
  environments_current: 2,
  environments_behind: 0,
  environments_unhealthy: 0,
  environments_empty: 0,
};

const HOST_ME = {
  principal: "host:uid:1000",
  kind: "human",
  capabilities: ["read", "management"],
  user: "alice",
  groups: ["tenkai-viewer"],
  source: "host",
};

const PASS = {
  version: 1,
  release_digest: "8f3a",
  failures: [],
  satisfied_by: { database: "postgres@16.2.0", catalog: "catalog@1.4.0" },
};

const BLOCKED = {
  version: 1,
  release_digest: "8f3a",
  failures: [
    { reason: "missing_contract", contract: "analytics" },
    { reason: "incompatible_contract", contract: "payments" },
  ],
  satisfied_by: { catalog: "catalog@1.4.0" },
};

const ok = (body: unknown): Reply => ({ status: 200, body });

const server =
  (reports: Record<string, Reply>): Routes =>
  (path) => {
    if (path === "/v1/auth/oidc") {
      return { status: 404, body: { error: "no oidc client" } };
    }
    if (path === "/v1/auth/me") {
      return ok(HOST_ME);
    }
    if (path === "/v1/fleet/status") {
      return ok(FLEET);
    }
    if (path === "/v1/environments") {
      return ok(FLEET.environments.map(({ id, name, description }) => ({ id, name, description })));
    }
    if (path === "/v1/channels") {
      return ok({ items: [] });
    }
    const match = /^\/v1\/environments\/([^/]+)\/compatibility\/([^/]+)$/.exec(path);
    if (match) {
      return reports[match[1] ?? ""] ?? { status: 404, body: { error: "not found" } };
    }
    return undefined;
  };

// Signed-in screens run at desktop width: the top bar's tabs do not fit a phone yet.
test.describe("release compatibility", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("shows matched providers, blocked copy, and the selected environment document", async ({
    page,
  }) => {
    app = await serveConsole(server({ prod: ok(PASS), "edge-1": ok(BLOCKED) }));
    await page.goto(app.url);
    await page.getByRole("link", { name: "Releases" }).click();
    await expect(page.getByRole("heading", { name: "Compatibility" })).toBeVisible();
    await page.getByLabel("Release to check").fill("shop@2.1.0");
    const table = page
      .locator("table")
      .filter({ has: page.getByRole("columnheader", { name: "Matched" }) });
    await table.getByRole("row").filter({ hasText: /^prod/ }).click();
    await expect(table.getByRole("row").filter({ hasText: /^prod/ })).toContainText("compatible");
    await expect(
      table.getByRole("cell", { name: "postgres@16.2.0 · catalog@1.4.0" }),
    ).toBeVisible();
    const document = page
      .locator("table")
      .filter({ has: page.getByRole("columnheader", { name: "Provided by" }) });
    await expect(
      document.getByRole("cell", { name: "postgres@16.2.0", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath("compatibility-pass.png"),
      fullPage: true,
    });
    await table
      .getByRole("row")
      .filter({ hasText: /^edge-1/ })
      .click();
    await expect(table.getByRole("row").filter({ hasText: /^edge-1/ })).toContainText("blocked");
    await expect(page.getByText("analytics missing")).toBeVisible();
    await expect(page.getByText("payments incompatible")).toBeVisible();
    await expect(page.getByText("incompatible_contract")).toHaveCount(0);
    await page.screenshot({
      path: test.info().outputPath("compatibility-blocked.png"),
      fullPage: true,
    });
    await expectDesignRules(page);
    const reads = app.sent.filter(
      (sent) => sent.method === "GET" && sent.path.includes("/compatibility/"),
    );
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every((sent) => sent.authorization === undefined)).toBe(true);
  });

  test("keeps matched empty when the report omits satisfied_by", async ({ page }) => {
    app = await serveConsole(
      server({
        prod: ok({ version: 1, release_digest: "8f3a", failures: [] }),
        "edge-1": ok({ version: 1, release_digest: "8f3a", failures: [] }),
      }),
    );
    await page.goto(app.url);
    await page.getByRole("link", { name: "Releases" }).click();
    await page.getByLabel("Release to check").fill("shop@2.1.0");
    await expect(page.getByText("compatible").first()).toBeVisible();
    await expect(page.getByText("none").first()).toBeVisible();
    await expect(page.getByText("incompatible_contract")).toHaveCount(0);
    await expectDesignRules(page);
  });
});
