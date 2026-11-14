// Per-step apply results against a mocked API. Run with `pnpm build && pnpm e2e`.
import { expect, test } from "@playwright/test";
import type { EnvironmentInspectReport, FleetStatusReport } from "../src/api/tenkai.gen";
import {
  type MockBackend,
  type Reply,
  type Routes,
  expectDesignRules,
  serveConsole,
} from "./mock-backend";

const FLEET: FleetStatusReport = {
  environments: [
    {
      id: "env:prod",
      name: "prod",
      description: "fixture",
      subscription_count: 2,
      products_current: 0,
      products_behind: 2,
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

const INSPECT = {
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
    step_count: 2,
    digest: "sha256:abc",
    steps: [
      {
        id: "s1",
        order: 1,
        product: "api",
        action: "upgrade",
        release_id: "rel:1",
        from: "1.0.0",
        to: "1.1.0",
        instance: "api",
      },
      {
        id: "s2",
        order: 2,
        product: "web",
        action: "upgrade",
        release_id: "rel:2",
        from: "1.0.0",
        to: "2.0.0",
        instance: "web",
      },
    ],
  },
  subscriptions: [
    {
      product: "api",
      instance: "api",
      channel: "stable",
      head: "1.1.0",
      deployed: "1.0.0",
      state: "behind",
    },
    {
      product: "web",
      instance: "web",
      channel: "stable",
      head: "2.0.0",
      deployed: "1.0.0",
      state: "behind",
    },
  ],
} as unknown as EnvironmentInspectReport;

const HOST_ME = {
  principal: "host:uid:1000",
  kind: "human",
  capabilities: ["read", "management"],
  user: "alice",
  groups: ["tenkai-operator"],
  source: "host",
};

const APPROVALS = {
  plan_id: "tenkai:plan:1",
  plan_digest: "sha256:abc",
  purpose: "execute_plan",
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
    purpose: "apply",
    skip_gates: false,
  },
});
const ROOTS = JSON.stringify({
  version: 1,
  signers: [{ identity: "ops", key_id: "ops-1", public_key: "k" }],
});

const SUCCEEDED = {
  product: "api",
  instance: "api",
  action: "upgrade",
  status: "succeeded",
  to_version: "1.1.0",
  attempt_id: "dep:api:1",
};

const FAILED = {
  product: "api",
  instance: "api",
  action: "upgrade",
  status: "failed",
  to_version: "1.1.0",
  restored_version: "1.0.0",
  detail: "probe failed",
  detail_truncated: true,
  cause: {
    phase: "health_probe",
    kind: "probe_failed",
    summary: "probe failed",
  },
  attempt_id: "dep:api:1",
};

const ok = (body: unknown): Reply => ({ status: 200, body });

const server = (apply: Reply): Routes => {
  return (rawPath, request) => {
    const path = decodeURIComponent(rawPath);
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
      return ok([{ id: "env:prod", name: "prod", description: "fixture" }]);
    }
    if (path === "/v1/channels") {
      return ok({ items: [] });
    }
    if (path === "/v1/environments/prod") {
      return ok(INSPECT);
    }
    if (path === "/v1/environments/prod/runtime") {
      return ok({ environment: "prod", components: [] });
    }
    if (path === "/v1/environments/prod/dependencies") {
      return ok({ environment: "prod", holds: [], products: [] });
    }
    if (path === "/v1/environments/prod/history") {
      return ok({ items: [] });
    }
    if (path === "/v1/environments/prod/approval-policy") {
      return ok({ configured: true, mode: "human" });
    }
    if (path === "/v1/plans/tenkai:plan:1/approvals") {
      return ok(APPROVALS);
    }
    if (path === "/v1/plans/tenkai:plan:1/apply" && request.method === "POST") {
      return apply;
    }
    return undefined;
  };
};

const pasteAndApply = async (page: import("@playwright/test").Page) => {
  await page.getByLabel("Approval envelope").fill(ENVELOPE);
  await page.getByLabel("Approval trust roots").fill(ROOTS);
  await page.getByRole("button", { name: "Apply" }).click();
};

const openPlan = async (page: import("@playwright/test").Page, app: MockBackend) => {
  await page.goto(app.url);
  await page.getByRole("link", { name: "Environments" }).click();
  await page.getByRole("link", { name: "Open plan" }).click();
};

const steps = (page: import("@playwright/test").Page) =>
  page.locator("table").filter({ has: page.getByRole("columnheader", { name: "Restored" }) });

test.describe("plan apply steps", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("lists every succeeded step", async ({ page }) => {
    app = await serveConsole(
      server(
        ok({
          version: 1,
          operation: "apply",
          message: "applied",
          steps: [
            SUCCEEDED,
            {
              product: "web",
              instance: "web",
              action: "upgrade",
              status: "succeeded",
              to_version: "2.0.0",
              attempt_id: "dep:web:2",
            },
          ],
        }),
      ),
    );
    await openPlan(page, app);
    await pasteAndApply(page);
    const table = steps(page);
    await expect(table.getByRole("cell", { name: "succeeded" }).first()).toBeVisible();
    await expect(table.getByRole("cell", { name: "web", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "dep:api:1" })).toBeVisible();
    await expectDesignRules(page);
    expect(
      app.sent.some(
        (sent) =>
          sent.method === "POST" &&
          decodeURIComponent(sent.path) === "/v1/plans/tenkai:plan:1/apply" &&
          sent.search === "?steps=true",
      ),
    ).toBe(true);
  });

  test("lists failed, restored, and not run steps", async ({ page }) => {
    app = await serveConsole(
      server({ status: 422, body: { error: "apply failed", steps: [FAILED] } }),
    );
    await openPlan(page, app);
    await pasteAndApply(page);
    const table = steps(page);
    await expect(table.getByRole("cell", { name: "failed", exact: true })).toBeVisible();
    await expect(table.getByRole("cell", { name: "1.0.0", exact: true })).toBeVisible();
    await expect(table.getByRole("cell", { name: "not run", exact: true })).toBeVisible();
    await expect(table.getByText("cut")).toBeVisible();
    await expect(page.getByRole("status")).toHaveText("apply failed");
    await expectDesignRules(page);
  });

  test("reads steps a cancel stopped as skipped, not failed", async ({ page }) => {
    app = await serveConsole(
      server({
        status: 422,
        body: {
          error: "apply cancelled",
          steps: [
            SUCCEEDED,
            {
              product: "web",
              instance: "web",
              action: "upgrade",
              status: "skipped",
              to_version: "2.0.0",
              detail: "skipped: apply cancelled",
            },
          ],
        },
      }),
    );
    await openPlan(page, app);
    await pasteAndApply(page);
    const table = steps(page);
    await expect(table.getByRole("cell", { name: "skipped", exact: true })).toBeVisible();
    await expect(table.getByRole("cell", { name: "failed", exact: true })).toHaveCount(0);
    await expect(table.getByRole("cell", { name: "not run", exact: true })).toHaveCount(0);
    await expectDesignRules(page);
  });

  test("says detail is unavailable on an older server", async ({ page }) => {
    app = await serveConsole(
      server(ok({ version: 1, operation: "apply", message: "applied 1 step" })),
    );
    await openPlan(page, app);
    await pasteAndApply(page);
    await expect(page.getByRole("status")).toHaveText("applied 1 step");
    await expect(page.getByText("detail is unavailable")).toBeVisible();
    await expect(steps(page)).toHaveCount(0);
    await expectDesignRules(page);
  });

  test("shows no access when apply is forbidden", async ({ page }) => {
    app = await serveConsole(
      server({ status: 403, body: { error: "insufficient delivery capability" } }),
    );
    await openPlan(page, app);
    await pasteAndApply(page);
    await expect(page.getByRole("status")).toHaveText("No access");
    await expect(page.getByText("insufficient delivery capability")).toHaveCount(0);
    await expect(steps(page)).toHaveCount(0);
    await expectDesignRules(page);
  });
});

test.describe("plan apply steps on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("shows failed and not run steps without leaking internals", async ({ page }) => {
    app = await serveConsole(
      server({ status: 422, body: { error: "apply failed", steps: [FAILED] } }),
    );
    await openPlan(page, app);
    await pasteAndApply(page);
    const table = steps(page);
    await expect(table.getByRole("cell", { name: "failed", exact: true })).toBeVisible();
    await expect(table.getByRole("cell", { name: "not run", exact: true })).toBeVisible();
    expect(await page.locator("body").textContent()).not.toMatch(
      /\bADR\b|#\d+|HTTP \d{3}|\/v1\/|\bat \w+ \(|Error:|—/,
    );
  });
});
