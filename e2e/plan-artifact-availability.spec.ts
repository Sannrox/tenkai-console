// Plan-time artifact checks on the plan and approval page, against a mocked
// API. Run with `pnpm build && pnpm e2e`.
import { type Page, expect, test } from "@playwright/test";
import type { EnvironmentInspectReport, EnvironmentPlanSummary } from "../src/api/tenkai.gen";
import {
  type MockBackend,
  type Reply,
  type Routes,
  expectDesignRules,
  openActions,
  serveConsole,
} from "./mock-backend";

const DIGEST = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

type Artifact = { digest: string; registry: string; state: string };

const planWith = (artifacts: Artifact[] | undefined) =>
  ({
    id: "tenkai:plan:1",
    state: "computed",
    created_at: 1,
    step_count: 1,
    digest: "sha256:abc",
    ...(artifacts === undefined ? {} : { artifact_availability: artifacts }),
    steps: [
      {
        id: "s1",
        order: 1,
        product: "api",
        action: "upgrade",
        release_id: "rel:1",
        from: "1.0.0",
        to: "1.1.0",
      },
    ],
  }) as unknown as EnvironmentPlanSummary;

const inspect = (latest: EnvironmentPlanSummary | null) =>
  ({
    id: "env:prod",
    name: "prod",
    description: "fixture",
    execution_note: "",
    facts: {},
    lease: { held: false, status: "free" },
    latest_plan: latest,
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

const server = (environment: Reply, plan?: Reply): Routes => {
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
    if (path === "/v1/environments/prod/plans") {
      return request.method === "POST"
        ? (plan ?? { status: 404, body: { error: "not found" } })
        : undefined;
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

const artifacts = (page: Page) => page.getByRole("region", { name: "Artifacts" });

const openPlan = async (page: Page, app: MockBackend) => {
  await page.goto(app.url);
  await expect(page.getByRole("heading", { name: "Environments" })).toBeVisible();
  await page.evaluate(() => {
    history.pushState({}, "", `${location.pathname}environments/prod/plan`);
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await page.waitForLoadState("networkidle");
};

const capture = (page: Page, name: string) =>
  page.screenshot({ path: test.info().outputPath(`${name}.png`) });

const expectRules = async (page: Page, region = true) => {
  const width = page.viewportSize()?.width ?? 0;
  if (width >= 1024) {
    await expectDesignRules(page);
    return;
  }
  if (region) {
    const box = await artifacts(page).evaluate((node) => ({
      right: node.getBoundingClientRect().right,
      overflow: node.scrollWidth - node.clientWidth,
    }));
    expect(box.right).toBeLessThanOrEqual(width);
    expect(box.overflow).toBeLessThanOrEqual(0);
  }
  expect(await page.locator("body").textContent()).not.toMatch(
    /\bADR\b|#\d+|HTTP \d{3}|\/v1\/|\bat \w+ \(|Error:|—/,
  );
};

for (const viewport of [
  { name: "desktop", width: 1280, height: 800 },
  { name: "phone", width: 390, height: 844 },
]) {
  test.describe(`plan artifact availability on ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });
    let app: MockBackend;
    test.afterEach(async () => {
      await app.close();
    });

    test("shows unverifiable artifacts before signing", async ({ page }) => {
      app = await serveConsole(
        server(
          ok(
            inspect(
              planWith([
                { digest: DIGEST, registry: "mirror.internal", state: "available" },
                {
                  digest: DIGEST.replace("aa", "bb"),
                  registry: "mirror.internal",
                  state: "unverifiable",
                },
              ]),
            ),
          ),
        ),
      );
      await openPlan(page, app);
      const region = artifacts(page);
      await expect(region.getByText("unverifiable")).toBeVisible();
      await expect(region.getByText("apply checks it")).toBeVisible();
      await expect(region.getByText("mirror.internal").first()).toBeVisible();
      const order = await page.evaluate(() => {
        const lead = document.querySelector('[aria-label="Artifacts"]');
        const approval = [...document.querySelectorAll("h2")].find(
          (heading) => heading.textContent === "Approval",
        );
        return Boolean(
          lead &&
          approval &&
          lead.compareDocumentPosition(approval) & Node.DOCUMENT_POSITION_FOLLOWING,
        );
      });
      expect(order).toBe(true);
      await capture(page, `unverifiable-${viewport.name}`);
      await expectRules(page);
    });

    test("says all available when every digest was found", async ({ page }) => {
      app = await serveConsole(
        server(
          ok(
            inspect(
              planWith([{ digest: DIGEST, registry: "mirror.internal", state: "available" }]),
            ),
          ),
        ),
      );
      await openPlan(page, app);
      await expect(artifacts(page).getByText("all available")).toBeVisible();
      await expect(artifacts(page).getByText("available", { exact: true })).toBeVisible();
      await capture(page, `available-${viewport.name}`);
      await expectRules(page);
    });

    test("says no artifact checks when the server sends none", async ({ page }) => {
      app = await serveConsole(server(ok(inspect(planWith(undefined)))));
      await openPlan(page, app);
      await expect(artifacts(page).getByText("No artifact checks on this plan")).toBeVisible();
      await expect(page.getByRole("button", { name: "Approve only" })).toBeVisible();
      await expectRules(page);
    });

    test("names digest and registry when planning refuses a missing artifact", async ({ page }) => {
      app = await serveConsole(
        server(ok(inspect(null)), {
          status: 409,
          body: {
            error:
              "artifact digest sha256:dead is missing from registry mirror.internal; publish it there before planning",
          },
        }),
      );
      await openPlan(page, app);
      await (await openActions(page)).getByRole("button", { name: "Plan" }).click();
      await expect(page.getByRole("status")).toContainText("sha256:dead");
      await expect(page.getByRole("status")).toContainText("mirror.internal");
      expect(
        app.sent.some(
          (sent) => sent.method === "POST" && sent.path === "/v1/environments/prod/plans",
        ),
      ).toBe(true);
      await capture(page, `missing-${viewport.name}`);
      await expectRules(page, false);
    });
  });
}
