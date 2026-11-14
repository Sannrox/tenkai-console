// The approval brief leading the plan and approval page, against a mocked
// API. Run with `pnpm build && pnpm e2e`.
import { type Page, expect, test } from "@playwright/test";
import type {
  ApprovalBrief,
  EnvironmentInspectReport,
  EnvironmentPlanSummary,
} from "../src/api/tenkai.gen";
import {
  type MockBackend,
  type Reply,
  type Routes,
  expectDesignRules,
  serveConsole,
} from "./mock-backend";

const BRIEF: ApprovalBrief = {
  proposer: "alice",
  blast_radius: {
    environment: "prod",
    instances: ["api", "worker"],
    criticality: "high",
    rollback_available: true,
  },
  changes: { counts: { Deployment: 2, Service: 1 } },
  evidence: ["preview", "gates"],
  policy: { without_human: "auto", budget: "not_configured" },
};

const RISKY = ["deleted_volume:Deployment api", "changed_ports:Service api"];

// Enough steps that the page runs well past one screen on both viewports.
const planWith = (brief: ApprovalBrief | undefined): EnvironmentPlanSummary => ({
  id: "tenkai:plan:1",
  state: "computed",
  created_at: 1,
  step_count: 12,
  digest: "sha256:abc",
  ...(brief === undefined ? {} : { approval_brief: brief }),
  steps: Array.from({ length: 12 }, (_, index) => ({
    id: `s${index}`,
    order: index,
    product: `svc-${index}`,
    action: "upgrade",
    release_id: `rel:${index}`,
    from: "1.0.0",
    to: "1.1.0",
    target_changes: [
      { kind: "Deployment", name: `svc-${index}`, live_digest: "sha256:d", field_count: 2 },
    ],
  })),
});

const inspect = (brief: ApprovalBrief | undefined) =>
  ({
    id: "env:prod",
    name: "prod",
    description: "fixture",
    execution_note: "",
    facts: {},
    lease: { held: false, status: "free" },
    latest_plan: planWith(brief),
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

const ok = (body: unknown): Reply => ({ status: 200, body });

const server = (environment: Reply): Routes => {
  return (rawPath) => {
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
    if (path === "/v1/environments") {
      return ok([{ id: "env:prod", name: "prod", description: "fixture" }]);
    }
    if (path === "/v1/fleet/status") {
      return ok({ environments: [], environment_count: 0 });
    }
    if (path === "/v1/channels") {
      return ok({ items: [] });
    }
    if (path === "/v1/environments/prod") {
      return environment;
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
        exclude_requester: false,
        collected: [],
        missing: 1,
      });
    }
    return undefined;
  };
};

const brief = (page: Page) => page.getByRole("region", { name: "Approval brief" });

// A deep link would resolve the bundle's relative assets under the route, so
// the test signs in at the root and moves the router to the plan in place.
const openPlan = async (page: Page, app: MockBackend) => {
  await page.goto(app.url);
  await expect(page.getByRole("link", { name: "Environments" })).toBeVisible();
  await page.evaluate(() => {
    history.pushState({}, "", `${location.pathname}environments/prod/plan`);
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await page.waitForLoadState("networkidle");
};

const capture = (page: Page, name: string) =>
  page.screenshot({ path: test.info().outputPath(`${name}.png`) });

/** The element sits wholly inside the first screen, with the page unscrolled. */
const expectAboveFold = async (page: Page, name: string) => {
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const box = await brief(page).getByLabel(name).boundingBox();
  const height = page.viewportSize()?.height ?? 0;
  expect(box).not.toBeNull();
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(height);
  expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
};

// The top navigation overflows a phone on every screen today, so a phone holds
// the brief to the viewport and the copy rules instead.
const expectRules = async (page: Page) => {
  const width = page.viewportSize()?.width ?? 0;
  if (width >= 1024) {
    await expectDesignRules(page);
    return;
  }
  const region = await brief(page).evaluate((node) => ({
    right: node.getBoundingClientRect().right,
    overflow: node.scrollWidth - node.clientWidth,
  }));
  expect(region.right).toBeLessThanOrEqual(width);
  expect(region.overflow).toBeLessThanOrEqual(0);
  expect(await page.locator("body").textContent()).not.toMatch(
    /\bADR\b|#\d+|HTTP \d{3}|\/v1\/|\bat \w+ \(|Error:|—/,
  );
};

for (const viewport of [
  { name: "desktop", width: 1280, height: 800 },
  { name: "phone", width: 390, height: 844 },
]) {
  test.describe(`plan approval brief on ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });
    let app: MockBackend;
    test.afterEach(async () => {
      await app.close();
    });

    test("leads with flagged risky changes above the fold", async ({ page }) => {
      app = await serveConsole(
        server(ok(inspect({ ...BRIEF, changes: { ...BRIEF.changes, risky: RISKY } }))),
      );
      await openPlan(page, app);
      const risky = brief(page).getByLabel("Risky changes");
      await expect(risky.getByText("deleted volume")).toBeVisible();
      await expect(risky.getByText("Deployment api")).toBeVisible();
      await expect(risky.getByText("changed ports")).toBeVisible();
      await expectAboveFold(page, "Risky changes");
      await capture(page, `risky-${viewport.name}`);

      // Steps and target changes stay below the brief.
      const order = await page.evaluate(() => {
        const lead = document.querySelector('[aria-label="Approval brief"]');
        const changes = document.querySelector('[aria-label="Target changes"]');
        const steps = [...document.querySelectorAll("h2")].find((h) =>
          h.textContent?.startsWith("Steps"),
        );
        const after = (node: Element | null | undefined) =>
          Boolean(
            lead && node && lead.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING,
          );
        return after(changes) && after(steps);
      });
      expect(order).toBe(true);
      await expect(brief(page).getByText("prod · api, worker · criticality high")).toBeVisible();
      await expect(brief(page).getByText("Deployment 2, Service 1")).toBeVisible();
      await expectRules(page);
    });

    test("says none flagged, with the human proposer and evidence", async ({ page }) => {
      app = await serveConsole(server(ok(inspect(BRIEF))));
      await openPlan(page, app);
      await expect(brief(page).getByLabel("Risky changes")).toHaveText("none flagged");
      await expectAboveFold(page, "Risky changes");
      await expect(brief(page).getByText("alice", { exact: true })).toBeVisible();
      await expect(brief(page).getByText("agent proposed")).toHaveCount(0);
      await expect(brief(page).getByText("preview, gates")).toBeVisible();
      await expect(brief(page).getByText("budget")).toHaveCount(0);
      await expectRules(page);
    });

    test("says no evidence is attached", async ({ page }) => {
      const { evidence: _, ...bare } = BRIEF;
      app = await serveConsole(server(ok(inspect(bare))));
      await openPlan(page, app);
      await expect(brief(page).getByText("none attached")).toBeVisible();
      await expectRules(page);
    });

    test("labels an agent plan with the delegating user, inside budget", async ({ page }) => {
      app = await serveConsole(
        server(
          ok(
            inspect({
              ...BRIEF,
              actor_chain: [{ id: "assistant-7", kind: "agent" }],
              policy: { without_human: "auto", budget: "inside" },
            }),
          ),
        ),
      );
      await openPlan(page, app);
      await expect(brief(page).getByText("agent proposed")).toBeVisible();
      await expect(brief(page).getByText("assistant-7 for alice")).toBeVisible();
      await expect(brief(page).getByText("assistant-7 agent")).toBeVisible();
      await expect(brief(page).getByText("inside agent budget")).toBeVisible();
      await capture(page, `agent-${viewport.name}`);
      await expectRules(page);
    });

    test("shows an agent plan over budget and why it needs a human", async ({ page }) => {
      app = await serveConsole(
        server(
          ok(
            inspect({
              ...BRIEF,
              actor_chain: [{ id: "assistant-7", kind: "agent" }],
              changes: { risky: RISKY },
              policy: {
                without_human: "require_human",
                reason: "product criticality high",
                budget: "over",
              },
            }),
          ),
        ),
      );
      await openPlan(page, app);
      await expect(brief(page).getByText("over agent budget")).toBeVisible();
      await expect(brief(page).getByText("needs a human: product criticality high")).toBeVisible();
      await expectAboveFold(page, "Risky changes");
      await capture(page, `over-budget-${viewport.name}`);
      await expectRules(page);
    });

    test("says no approval brief when the server sends none", async ({ page }) => {
      app = await serveConsole(server(ok(inspect(undefined))));
      await openPlan(page, app);
      await expect(brief(page).getByText("No approval brief for this plan")).toBeVisible();
      await expect(page.getByRole("button", { name: "Approve only" })).toBeVisible();
      await expectRules(page);
    });

    test("says no access without the server's words", async ({ page }) => {
      app = await serveConsole(
        server({ status: 403, body: { error: "insufficient delivery capability" } }),
      );
      await openPlan(page, app);
      await expect(page.getByText("No access to this plan")).toBeVisible();
      await expect(page.getByText("insufficient delivery capability")).toHaveCount(0);
      await expect(brief(page)).toHaveCount(0);
      await capture(page, `no-access-${viewport.name}`);
      expect(await page.locator("body").textContent()).not.toMatch(/HTTP \d{3}|\/v1\//);
    });
  });
}
