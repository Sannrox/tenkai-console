// Product, release, runner, plan and finding object pages. Run with `pnpm build && pnpm e2e`.
import { expect, test, type Page } from "@playwright/test";
import type { FleetStatusReport } from "../src/api/tenkai.gen";
import { shortId } from "../src/delivery/runners";
import {
  type MockBackend,
  type Reply,
  type Routes,
  expectDesignRules,
  openActions,
  openApp,
  openEnvironment,
  serveConsole,
} from "./mock-backend";

const ok = (body: unknown): Reply => ({ status: 200, body });

const FLEET: FleetStatusReport = {
  environments: [
    {
      id: "env:prod",
      name: "prod",
      description: "fixture",
      subscription_count: 1,
      products_current: 0,
      products_behind: 1,
      products_missing: 0,
      unhealthy: false,
      health_summary: "ok",
      lease_held: false,
      posture: "behind",
    },
  ],
  environment_count: 1,
  environments_current: 0,
  environments_behind: 1,
  environments_unhealthy: 0,
  environments_empty: 0,
};

const OPERATOR_ME = {
  principal: "host:uid:1000",
  kind: "human",
  capabilities: ["read", "management"],
  user: "alice",
  groups: ["tenkai-operator"],
  source: "host",
};

const INSPECT = {
  id: "env:prod",
  name: "prod",
  description: "fixture",
  execution_note: "",
  facts: { region: "eu" },
  lease: { held: true, generation: 4, status: "held" },
  latest_plan: {
    id: "tenkai:plan:1",
    state: "computed",
    created_at: 1,
    step_count: 1,
    digest: "sha256:abc",
    steps: [
      {
        id: "s1",
        order: 1,
        product: "api",
        action: "upgrade",
        from: "1.0.0",
        to: "1.1.0",
        release_id: "tenkai:release:api@1.1.0",
      },
    ],
  },
  subscriptions: [
    { product: "api", channel: "stable", head: "1.1.0", deployed: "1.0.0", state: "behind" },
  ],
};

const RUNNER = {
  id: "sha256:0123456789abcdef0123",
  environment: "prod",
  state: "active",
  auth: "bearer",
  instances: [
    {
      instance_id: "api-1",
      holds_lease: true,
      last_heartbeat_at: Date.UTC(2026, 10, 21, 12),
      last_work_at: Date.UTC(2026, 10, 21, 11),
      runtime_version: "0.4.0",
      skew: "current",
    },
  ],
};

const FINDING = {
  advisory_id: "CVE-2026-1",
  component: "openssl",
  component_version: "3.0.0",
  release: "api@1.0.0",
  release_id: "tenkai:release:api@1.0.0",
  severity: "high",
  grace: [{ environment: "prod", grace_ends_at: Date.UTC(2026, 11, 1), in_grace: true }],
};

const server = (): Routes => (raw, request) => {
  const path = decodeURIComponent(raw);
  if (path === "/v1/auth/oidc") {
    return { status: 404, body: { error: "no oidc client" } };
  }
  if (path === "/v1/auth/me") {
    return ok(OPERATOR_ME);
  }
  if (path === "/v1/fleet/status") {
    return ok(FLEET);
  }
  if (path === "/v1/environments") {
    return ok([{ id: "env:prod", name: "prod", description: "fixture" }]);
  }
  if (path === "/v1/channels") {
    return ok({
      items: [{ id: "ch:api:stable", product: "api", name: "stable", head: "1.1.0" }],
    });
  }
  if (path === "/v1/environments/prod") {
    return ok(INSPECT);
  }
  if (path === "/v1/environments/prod/hold") {
    return ok({ audit: [] });
  }
  if (path === "/v1/environments/prod/dependencies") {
    return ok({ environment: "prod", holds: [], products: [] });
  }
  if (path === "/v1/environments/prod/status") {
    return ok([]);
  }
  if (path === "/v1/environments/prod/runtime") {
    return ok({ environment: "prod", components: [] });
  }
  if (path === "/v1/products/api/owner") {
    return ok({ contact: "platform-team" });
  }
  if (path === "/v1/products/api/webhooks") {
    return ok([]);
  }
  if (path === "/v1/products/api/criticality") {
    return ok({ effective: "high" });
  }
  if (path === "/v1/releases") {
    return ok({
      items: [
        { id: "tenkai:release:api@1.1.0", product: "api", version: "1.1.0", digest: "sha256:aa" },
        { id: "tenkai:release:api@1.0.0", product: "api", version: "1.0.0", digest: "sha256:bb" },
      ],
    });
  }
  if (path === "/v1/runners") {
    return ok({ runners: [RUNNER] });
  }
  if (path === `/v1/runners/${RUNNER.id}`) {
    return ok(RUNNER);
  }
  if (path === "/v1/advisory-feed") {
    return ok({
      advisory_count: 1,
      age_ms: 0,
      generated_at: 1,
      imported: true,
      imported_at: 1,
      matches: [FINDING],
    });
  }
  if (path.includes("/v1/plans/") && !path.includes("/approvals") && request.method !== "POST") {
    return ok(INSPECT.latest_plan);
  }
  if (path === "/v1/environments/prod/approval-policy") {
    return ok({ configured: true, mode: "human" });
  }
  if (path === "/v1/plans/tenkai:plan:1/approvals") {
    return ok({
      plan_id: "tenkai:plan:1",
      plan_digest: "sha256:abc",
      purpose: "execute_plan",
      required: 1,
      groups: ["ops"],
      collected: [],
      missing: 1,
    });
  }
  if (path.startsWith("/v1/environments/prod/compatibility/")) {
    return ok({ version: 1, release_digest: "aa", failures: [], satisfied_by: {} });
  }
  if (request.method === "POST" && path.endsWith("/recall")) {
    return ok({ version: 1, operation: "recall", message: "recalled api@1.0.0" });
  }
  if (request.method === "POST" && path.endsWith("/revoke")) {
    return ok({
      credential_id: RUNNER.id,
      environment: "prod",
      revoked_at: Date.UTC(2026, 10, 21, 12),
    });
  }
  return undefined;
};

const shot = (page: Page, name: string) =>
  page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });

const signIn = async (page: Page, url: string) => {
  await page.goto(url);
  await expect(page.getByRole("heading", { name: "Environments" })).toBeVisible();
};

test.describe("object pages at desktop width", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("prod to api to 1.1.0 to plan without a full reload", async ({ page }) => {
    app = await serveConsole(server());
    await signIn(page, app.url);
    await openEnvironment(page);
    await expect(page.getByRole("heading", { name: "prod", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "api", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "tenkai:plan:1" })).toBeVisible();
    await page.getByRole("link", { name: "api", exact: true }).first().click();
    await expect(page.getByRole("heading", { name: "api", exact: true })).toBeVisible();
    expect(new URL(page.url()).pathname.endsWith("/products/api")).toBe(true);
    await expect(page.getByText("platform-team")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Product" })).toBeVisible();
    await shot(page, "product-overview");
    await page
      .getByRole("navigation", { name: "Product" })
      .getByRole("link", { name: "Linked" })
      .click();
    expect(new URL(page.url()).pathname.endsWith("/products/api/linked")).toBe(true);
    await expect(page.getByRole("heading", { name: "Linked" })).toBeVisible();
    await page
      .getByRole("navigation", { name: "Product" })
      .getByRole("link", { name: "Overview" })
      .click();
    await page.getByRole("link", { name: "api@1.1.0" }).first().click();
    await expect(page.getByRole("heading", { name: "api@1.1.0", exact: true })).toBeVisible();
    expect(new URL(page.url()).pathname.endsWith("/releases/api/1.1.0")).toBe(true);
    await expect(page.getByText("Not recalled.")).toBeVisible();
    await shot(page, "release-overview");
    await page.getByRole("link", { name: "plan", exact: true }).click();
    await expect(page.getByRole("heading", { name: "api 1.0.0 → 1.1.0" })).toBeVisible();
    await expectDesignRules(page);
    await shot(page, "plan-from-release");
  });

  test("runner and finding pages keep current revoke and waiver routes", async ({ page }) => {
    app = await serveConsole(server());
    await signIn(page, app.url);
    await openApp(page, "Runners");
    const runnerLabel = shortId(RUNNER.id);
    await page.getByRole("link", { name: runnerLabel, exact: true }).click();
    await expect(page.getByRole("heading", { name: runnerLabel, exact: true })).toBeVisible();
    expect(new URL(page.url()).pathname.includes("/runners/")).toBe(true);
    await shot(page, "runner-overview");
    await (await openActions(page)).getByRole("button", { name: "Revoke" }).click();
    await page.getByLabel(`Revoke reason for ${runnerLabel}`).fill("rotate");
    await page.getByRole("button", { name: "Revoke", exact: true }).click();
    const revoke = page.waitForRequest((request) => request.url().includes("/revoke"));
    await page.getByRole("button", { name: `Revoke ${runnerLabel} of prod` }).click();
    expect((await revoke).postDataJSON()).toStrictEqual({ reason: "rotate" });

    await openApp(page, "Exposure");
    await page.getByRole("link", { name: "CVE-2026-1" }).click();
    await expect(page.getByRole("heading", { name: "CVE-2026-1", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "prod", exact: true }).first()).toBeVisible();
    await expect(page.getByText("Not recalled.")).toBeVisible();
    await expectDesignRules(page);
    await shot(page, "finding-overview");
  });

  test("exact plan id loads GET /v1/plans/{id}", async ({ page }) => {
    app = await serveConsole(server());
    await signIn(page, app.url);
    // Nested object URLs cannot be a full document load: `base: "./"` resolves
    // assets from `/ui/plans/`, so the router is pushed from `/ui/`.
    await page.evaluate(() => {
      const root = window.location.pathname.endsWith("/")
        ? window.location.pathname
        : `${window.location.pathname}/`;
      history.pushState({}, "", `${root}plans/${encodeURIComponent("tenkai:plan:1")}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect(page.getByRole("heading", { name: "api 1.0.0 → 1.1.0" })).toBeVisible();
    expect(
      app.sent.some(
        (call) =>
          call.method === "GET" &&
          decodeURIComponent(call.path).includes("/v1/plans/tenkai:plan:1"),
      ),
    ).toBe(true);
    await expectDesignRules(page);
  });
});

test.describe("object pages at phone width", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("product page fits and keeps the journey", async ({ page }) => {
    app = await serveConsole(server());
    await signIn(page, app.url);
    await openEnvironment(page);
    await page.getByRole("link", { name: "api", exact: true }).first().click();
    await expect(page.getByRole("heading", { name: "api", exact: true })).toBeVisible();
    await expectDesignRules(page);
    await shot(page, "product-phone");
  });
});
