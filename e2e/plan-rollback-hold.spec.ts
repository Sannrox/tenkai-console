// Hold choice when applying a rollback plan, against a mocked API. Run with `pnpm build && pnpm e2e`.
import { type Page, expect, test } from "@playwright/test";
import type { EnvironmentInspectReport, FleetStatusReport } from "../src/api/tenkai.gen";
import { type MockBackend, type Reply, expectDesignRules, serveConsole } from "./mock-backend";

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

const inspect = (action: string) =>
  ({
    id: "env:prod",
    name: "prod",
    description: "fixture",
    execution_note: "",
    facts: {},
    lease: { held: false, status: "free" },
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
          action,
          release_id: "rel:1",
          from: "1.1.0",
          to: "1.0.0",
          instance: "api",
        },
      ],
    },
    subscriptions: [
      {
        product: "api",
        instance: "api",
        channel: "stable",
        head: "1.1.0",
        deployed: "1.1.0",
        state: "current",
      },
    ],
  }) as unknown as EnvironmentInspectReport;

const APPROVALS = {
  plan_id: "tenkai:plan:1",
  plan_digest: "sha256:abc",
  purpose: "rollback",
  required: 1,
  groups: ["ops"],
  exclude_requester: false,
  collected: [{ key_id: "ops-1", signer_identity: "alice", groups: ["ops"] }],
  missing: 0,
};

const ENVELOPE = JSON.stringify({
  schema: "tenkai.plan-approval.v1",
  key_id: "ops-1",
  signature: "c2ln",
  statement: {
    environment: "prod",
    expires_at: 2,
    issued_at: 1,
    plan_digest: "sha256:abc",
    policy_digest: "sha256:def",
    policy_evidence_id: "ev-1",
    policy_provider: "tenkai",
    purpose: "rollback",
    skip_gates: false,
  },
});
const ROOTS = JSON.stringify({
  version: 1,
  signers: [{ identity: "ops", key_id: "ops-1", public_key: "k" }],
});

const ok = (body: unknown): Reply => ({ status: 200, body });

const APPLIED = ok({
  version: 1,
  operation: "apply",
  message: "applied rollback plan",
  steps: [
    {
      product: "api",
      instance: "api",
      action: "rollback",
      status: "succeeded",
      to_version: "1.0.0",
    },
  ],
});

const serve = (action = "rollback") =>
  serveConsole((rawPath, request) => {
    const path = decodeURIComponent(rawPath);
    if (path === "/v1/auth/oidc") {
      return { status: 404, body: { error: "no oidc client" } };
    }
    if (path === "/v1/auth/me") {
      return ok({
        principal: "host:uid:1000",
        kind: "human",
        capabilities: ["read", "management"],
        user: "alice",
        groups: ["tenkai-operator"],
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
      return ok(inspect(action));
    }
    if (path === "/v1/environments/prod/approval-policy") {
      return ok({ configured: true, mode: "human" });
    }
    if (path === "/v1/plans/tenkai:plan:1/approvals") {
      return ok(APPROVALS);
    }
    if (path === "/v1/plans/tenkai:plan:1/apply" && request.method === "POST") {
      return APPLIED;
    }
    return undefined;
  });

const openPlan = async (page: Page, app: MockBackend) => {
  await page.goto(app.url);
  await page.getByRole("link", { name: "Environments" }).click();
  await page.getByRole("link", { name: "Open plan" }).first().click();
  await page.getByLabel("Approval envelope").fill(ENVELOPE);
  await page.getByLabel("Approval trust roots").fill(ROOTS);
};

const holdBox = (page: Page) => page.getByRole("checkbox", { name: "Hold prod after rollback" });
const applyButton = (page: Page) => page.getByRole("button", { name: "Apply", exact: true });

/**
 * Desktop holds the page-wide design rules. The phone top navigation already
 * scrolls sideways, so on a phone the hold row itself must fit.
 */
const expectFits = async (page: Page, width: number) => {
  if (width > 400) {
    await expectDesignRules(page);
    return;
  }
  const row = page.getByText("Hold prod after rollback").locator("..");
  const box = await row.boundingBox();
  expect(box && box.x + box.width).toBeLessThanOrEqual(width);
  expect(await row.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(0);
};

const applyPosts = (app: MockBackend) =>
  app.sent.filter((sent) => sent.method === "POST" && sent.path.endsWith("/apply"));

for (const viewport of [
  { name: "desktop", width: 1280, height: 800 },
  { name: "phone", width: 390, height: 844 },
]) {
  test.describe(`rollback hold on ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });
    let app: MockBackend;
    test.afterEach(async () => {
      await app.close();
    });

    test("keeps the hold by default and sends no opt-out", async ({ page }) => {
      app = await serve();
      await openPlan(page, app);
      await expect(holdBox(page)).toBeChecked();
      await expect(page.getByLabel("Reason to skip the hold")).toHaveCount(0);
      await expectFits(page, viewport.width);
      const sent = page.waitForRequest((request) => request.url().includes("/apply"));
      await applyButton(page).click();
      expect((await sent).postDataJSON()).not.toHaveProperty("no_hold_reason");
      await expect(page.getByRole("status")).toHaveText("applied rollback plan");
    });

    test("needs a reason to skip the hold, then sends it", async ({ page }) => {
      app = await serve();
      await openPlan(page, app);
      await holdBox(page).uncheck();
      await expect(applyButton(page)).toBeDisabled();
      await page.getByLabel("Reason to skip the hold").fill("   ");
      await expect(applyButton(page)).toBeDisabled();
      await page.getByLabel("Reason to skip the hold").fill(" planned outage ");
      await expectFits(page, viewport.width);
      const sent = page.waitForRequest((request) => request.url().includes("/apply"));
      await applyButton(page).click();
      expect((await sent).postDataJSON()).toMatchObject({
        operation: "apply",
        no_hold_reason: "planned outage",
      });
      await expect(page.getByRole("status")).toHaveText("applied rollback plan");
    });
  });
}

test.describe("rollback hold edges", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("offers no hold choice on a plan that is not a rollback", async ({ page }) => {
    app = await serve("upgrade");
    await openPlan(page, app);
    await expect(applyButton(page)).toBeEnabled();
    await expect(holdBox(page)).toHaveCount(0);
  });

  test("reads a lost apply answer as unknown and sends it once", async ({ page }) => {
    app = await serve();
    await page.route("**/apply?steps=true", (route) => route.abort("connectionreset"));
    await openPlan(page, app);
    let posts = 0;
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/apply")) {
        posts += 1;
      }
    });
    await holdBox(page).uncheck();
    await page.getByLabel("Reason to skip the hold").fill("planned outage");
    await applyButton(page).click();
    await expect(page.getByRole("status")).toHaveText(
      "No answer from the server; the outcome is unknown until the next inspect.",
    );
    await page.waitForLoadState("networkidle");
    expect(posts).toBe(1);
    // The aborted request never reached the mock backend.
    expect(applyPosts(app)).toHaveLength(0);
    await expectDesignRules(page);
  });
});
