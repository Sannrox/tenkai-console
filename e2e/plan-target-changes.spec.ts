// What a plan changes in the target, on the plan and approval page, against a
// mocked API. Run with `pnpm build && pnpm e2e`.
import { type Page, expect, test } from "@playwright/test";
import type {
  EnvironmentInspectReport,
  EnvironmentPlanSummary,
  TargetChange,
} from "../src/api/tenkai.gen";
import {
  type MockBackend,
  type Reply,
  type Routes,
  expectDesignRules,
  serveConsole,
} from "./mock-backend";

const SECRET_VALUE = "s3cret-value-must-not-appear";
const PLAN_PATH = "/v1/plans/tenkai:plan:1";

const planWith = (changes: TargetChange[] | undefined): EnvironmentPlanSummary => ({
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
      release_id: "rel:1",
      from: "1.0.0",
      to: "1.1.0",
      instance: "api",
      ...(changes === undefined ? {} : { target_changes: changes }),
    },
  ],
});

// Inspect: per-object counts, no field values.
const COUNTS: TargetChange[] = [
  { kind: "Service", name: "api", live_digest: "sha256:svc", field_count: 1 },
  { kind: "Secret", name: "creds", live_digest: "sha256:sec", field_count: 1 },
  { kind: "File", name: "/etc/api/unit.conf", live_digest: "absent", field_count: 1 },
];

// Plan route: every field change. The Secret carries a value here on purpose:
// the console must not render it even if a server ever sent one.
const FULL: TargetChange[] = [
  {
    kind: "Service",
    name: "api",
    live_digest: "sha256:svc",
    field_count: 1,
    fields: [{ field: "ports", from: "80", to: "8080" }],
  },
  {
    kind: "Secret",
    name: "creds",
    live_digest: "sha256:sec",
    field_count: 1,
    fields: [{ field: "data.password", from: SECRET_VALUE, to: `${SECRET_VALUE}-new` }],
  },
  {
    kind: "File",
    name: "/etc/api/unit.conf",
    live_digest: "absent",
    field_count: 1,
    fields: [{ field: "content", to: "ExecStart=/usr/bin/api" }],
  },
];

const inspect = (changes: TargetChange[] | undefined) =>
  ({
    id: "env:prod",
    name: "prod",
    description: "fixture",
    execution_note: "",
    facts: {},
    lease: { held: false, status: "free" },
    latest_plan: planWith(changes),
    subscriptions: [
      {
        product: "api",
        instance: "api",
        channel: "stable",
        head: "1.1.0",
        deployed: "1.0.0",
        state: "behind",
      },
    ],
  }) as unknown as EnvironmentInspectReport;

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

const ok = (body: unknown): Reply => ({ status: 200, body });

const server = (
  changes: TargetChange[] | undefined,
  full: Reply,
  apply: Reply = ok({ version: 1, operation: "apply", message: "applied" }),
): Routes => {
  return (rawPath, request) => {
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
        groups: [],
        source: "host",
      });
    }
    if (path === "/v1/fleet/status") {
      return ok({
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
      });
    }
    if (path === "/v1/environments") {
      return ok([{ id: "env:prod", name: "prod", description: "fixture" }]);
    }
    if (path === "/v1/channels") {
      return ok({ items: [] });
    }
    if (path === "/v1/environments/prod") {
      return ok(inspect(changes));
    }
    if (path === "/v1/environments/prod/approval-policy") {
      return ok({ configured: true, mode: "human" });
    }
    if (path === `${PLAN_PATH}/approvals`) {
      return ok({
        plan_id: "tenkai:plan:1",
        plan_digest: "sha256:abc",
        purpose: "execute_plan",
        required: 1,
        groups: ["ops"],
        exclude_requester: false,
        collected: [{ key_id: "ops-1", signer_identity: "alice", groups: ["ops"] }],
        missing: 0,
      });
    }
    if (path === PLAN_PATH) {
      return full;
    }
    if (path === `${PLAN_PATH}/apply` && request.method === "POST") {
      return apply;
    }
    return undefined;
  };
};

const changes = (page: Page) => page.getByRole("region", { name: "Target changes" });
const planFetches = (app: MockBackend) =>
  app.sent.filter((sent) => decodeURIComponent(sent.path) === PLAN_PATH).length;

const openPlan = async (page: Page, app: MockBackend) => {
  await page.goto(app.url);
  await page.getByRole("link", { name: "Environments" }).click();
  await page.getByRole("link", { name: "Open plan" }).click();
  await expect(page.getByRole("heading", { name: "Approval", exact: true })).toBeVisible();
  await page.waitForLoadState("networkidle");
};

const capture = (page: Page, name: string) =>
  page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });

// The top navigation overflows a phone on every screen today, so a phone holds
// the target changes section to the viewport and the copy rules instead.
const expectRules = async (page: Page) => {
  const width = page.viewportSize()?.width ?? 0;
  if (width >= 1024) {
    await expectDesignRules(page);
    return;
  }
  const region = await changes(page).evaluate((node) => ({
    right: node.getBoundingClientRect().right,
    overflow: node.scrollWidth - node.clientWidth,
  }));
  expect(region.right).toBeLessThanOrEqual(width);
  expect(region.overflow).toBeLessThanOrEqual(0);
  expect(await page.locator("body").textContent()).not.toMatch(
    /\bADR\b|#\d+|HTTP \d{3}|\/v1\/|\bat \w+ \(|Error:|—/,
  );
};

const expectNoSecret = async (page: Page) => {
  expect(await page.locator("body").textContent()).not.toContain(SECRET_VALUE);
};

for (const viewport of [
  { name: "desktop", width: 1280, height: 800 },
  { name: "phone", width: 390, height: 844 },
]) {
  test.describe(`plan target changes on ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });
    let app: MockBackend;
    test.afterEach(async () => {
      await app.close();
    });

    test("shows counts before the approval, then the full diff on request", async ({ page }) => {
      app = await serveConsole(server(COUNTS, ok(planWith(FULL))));
      await openPlan(page, app);
      const region = changes(page);
      await expect(region.getByText("Service api")).toBeVisible();
      await expect(region.getByText("content digest changed")).toBeVisible();
      await expect(region.getByText("new, 1 field")).toBeVisible();
      expect(planFetches(app)).toBe(0);
      await capture(page, `counts-${viewport.name}`);

      // The diff sits above the approve and apply controls.
      const above = await page.evaluate(() => {
        const diff = document.querySelector('[aria-label="Target changes"]');
        const approve = [...document.querySelectorAll("button")].find(
          (button) => button.textContent === "Approve only",
        );
        return Boolean(
          diff &&
          approve &&
          diff.compareDocumentPosition(approve) & Node.DOCUMENT_POSITION_FOLLOWING,
        );
      });
      expect(above).toBe(true);

      await region.getByRole("button", { name: "Show full diff" }).click();
      await expect(region.getByText("+ 8080")).toBeVisible();
      await expect(region.getByText("- 80", { exact: true })).toBeVisible();
      await expect(region.getByText("+ ExecStart=/usr/bin/api")).toBeVisible();
      await capture(page, `full-${viewport.name}`);
      await expect(region.getByRole("button", { name: "Show full diff" })).toHaveCount(0);
      expect(planFetches(app)).toBe(1);
      await expectNoSecret(page);
      await expect(region.getByText("data.password")).toHaveCount(0);
      await expectRules(page);
    });

    test("says there are no changes", async ({ page }) => {
      app = await serveConsole(server(undefined, ok(planWith(undefined))));
      await openPlan(page, app);
      await expect(changes(page).getByText("No target changes")).toBeVisible();
      await expectRules(page);
    });

    test("says an older server does not report changes", async ({ page }) => {
      app = await serveConsole(server(undefined, { status: 404, body: { error: "not found" } }));
      await openPlan(page, app);
      await expect(
        changes(page).getByText("This server does not report target changes"),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Approve only" })).toBeVisible();
      await expectRules(page);
    });

    test("says no access without the server's words", async ({ page }) => {
      app = await serveConsole(
        server(COUNTS, { status: 403, body: { error: "insufficient delivery capability" } }),
      );
      await openPlan(page, app);
      await changes(page).getByRole("button", { name: "Show full diff" }).click();
      await expect(changes(page).getByText("No access to target changes")).toBeVisible();
      await expect(page.getByText("insufficient delivery capability")).toHaveCount(0);
      await expect(changes(page).getByText("Service api")).toBeVisible();
      await expectRules(page);
    });

    test("caps a large diff and counts the rest", async ({ page }) => {
      const fields = Array.from({ length: 520 }, (_, index) => ({
        field: `data.key${index}`,
        from: "a",
        to: "b".repeat(1000),
      }));
      app = await serveConsole(
        server(
          [{ kind: "ConfigMap", name: "cfg", live_digest: "sha256:cm", field_count: 520 }],
          ok(
            planWith([
              {
                kind: "ConfigMap",
                name: "cfg",
                live_digest: "sha256:cm",
                field_count: 520,
                fields,
              },
            ]),
          ),
        ),
      );
      await openPlan(page, app);
      await expect(changes(page).getByText("520 fields")).toBeVisible();
      await changes(page).getByRole("button", { name: "Show full diff" }).click();
      await expect(changes(page).getByText("20 more field changes not shown")).toBeVisible();
      await expect(changes(page).getByText("data.key499", { exact: true })).toBeVisible();
      await expect(changes(page).getByText("data.key500", { exact: true })).toHaveCount(0);
      await expect(changes(page).getByText(/ cut$/).first()).toBeVisible();
      await expectRules(page);
    });

    test("names the object a stale apply refused", async ({ page }) => {
      app = await serveConsole(
        server(COUNTS, ok(planWith(FULL)), {
          status: 422,
          body: {
            error: "apply did not succeed",
            steps: [
              {
                product: "api",
                instance: "api",
                action: "upgrade",
                status: "failed",
                to_version: "1.1.0",
                detail: "step s1 is stale",
                stale_target: { kind: "Service", name: "api" },
              },
            ],
          },
        }),
      );
      await openPlan(page, app);
      await page.getByLabel("Approval envelope").fill(ENVELOPE);
      await page.getByLabel("Approval trust roots").fill(ROOTS);
      await page.getByRole("button", { name: "Apply" }).click();
      await expect(page.getByText("Service api changed since planning")).toBeVisible();
      await expectNoSecret(page);
      await expectRules(page);
    });
  });
}
