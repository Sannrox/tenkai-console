// Channel promotion policy status on Releases against a mocked API. Run with `pnpm build && pnpm e2e`.
import { type Page, expect, test } from "@playwright/test";
import type {
  ChannelPromotionPolicyStatus,
  ChannelPromotionPolicyView,
  FleetStatusReport,
} from "../src/api/tenkai.gen";
import {
  HEALTHZ,
  type MockBackend,
  type Reply,
  type Routes,
  expectDesignRules,
  serveConsole,
} from "./mock-backend";

const FLEET: FleetStatusReport = {
  environments: [],
  environment_count: 0,
  environments_current: 0,
  environments_behind: 0,
  environments_unhealthy: 0,
  environments_empty: 0,
};

const policy = (
  product: string,
  source: string,
  target: string,
  patch: Partial<ChannelPromotionPolicyStatus>,
): ChannelPromotionPolicyStatus => ({
  product,
  source_channel: source,
  target_channel: target,
  policy_id: `channel-promotion-policy:${product}/${target}`,
  policy_version: 2,
  paused: false,
  state: "soaking",
  ...patch,
});

// One row per listed state: soak in progress, evidence missing, paused, promoted, reset.
const POLICIES: ChannelPromotionPolicyStatus[] = [
  policy("api", "dev", "candidate", {}),
  policy("api", "candidate", "stable", {
    state: "waiting",
    reason: "instances without health evidence",
    instances_without_evidence: ["edge-1", "edge-2"],
  }),
  policy("billing", "candidate", "stable", { paused: true, state: "waiting", reason: "paused" }),
  policy("web", "dev", "candidate", { state: "promoted" }),
  policy("web", "candidate", "stable", {
    state: "reset",
    reason: "health evidence failed on edge-3",
  }),
];

const CAPABLE: Reply = {
  status: 200,
  body: {
    status: "ok",
    profile: "fixture",
    capabilities: ["channel_promotion_policy:v1"],
    contracts: ["tenkai.http.v1"],
  },
};

const ok = (body: unknown): Reply => ({ status: 200, body });

const RULES = { health_slo: true, healthy_min_share: 0.95, failing_max_share: 0.05 };

// Detail beyond the status row, keyed by `<product>/<target>`.
const EXTRA: Record<string, Partial<ChannelPromotionPolicyView>> = {
  "api/candidate": {
    soaking_release: "api@1.4.0",
    elapsed_ms: 720_000,
    healthy_share: 0.98,
    failing_share: 0.01,
  },
  "billing/stable": { paused_by: "oidc:alice", paused_at: Date.UTC(2026, 10, 14, 9, 30) },
  "web/candidate": {
    promoted_by: "channel-promotion-policy:web/candidate",
    promoted_by_kind: "channel_promotion_policy",
  },
  "web/stable": {
    soaking_release: "web@2.0.0",
    elapsed_ms: 60_000,
    last_reset_at: Date.UTC(2026, 10, 14, 10, 5),
    last_reset_cause: "reset: health evidence failed on edge-3",
  },
};

const VIEWS: Record<string, ChannelPromotionPolicyView> = Object.fromEntries(
  POLICIES.map((row) => {
    const key = `${row.product}/${row.target_channel}`;
    const evidence = key === "api/stable" ? { ...RULES, recall_on_failing: true } : RULES;
    return [key, { ...row, soak_duration_ms: 3_600_000, evidence, ...EXTRA[key] }];
  }),
);

const POLICY = /^\/v1\/products\/([^/]+)\/channels\/([^/]+)\/policy(?:\/(pause|resume))?$/;

const server =
  (
    fleet: FleetStatusReport,
    healthz: Reply = CAPABLE,
    capabilities = ["read"],
    write: Reply = ok({ version: 1, operation: "channel_policy_resume", message: "resumed" }),
  ): Routes =>
  (path) => {
    const policyRoute = POLICY.exec(path);
    if (policyRoute) {
      const view = VIEWS[`${policyRoute[1]}/${policyRoute[2]}`];
      return policyRoute[3] ? write : view ? ok(view) : undefined;
    }
    if (path === "/healthz") {
      return healthz;
    }
    if (path === "/v1/auth/oidc") {
      return { status: 404, body: { error: "no oidc client" } };
    }
    if (path === "/v1/auth/me") {
      return ok({
        principal: "host:uid:1000",
        kind: "human",
        capabilities,
        user: "alice",
        groups: ["tenkai-viewer"],
        source: "host",
      });
    }
    if (path === "/v1/fleet/status") {
      return ok(fleet);
    }
    if (path === "/v1/environments" || path === "/v1/events") {
      return ok(path === "/v1/events" ? { events: [], next_cursor: "0" } : []);
    }
    if (path === "/v1/channels") {
      return ok({ items: [] });
    }
    return undefined;
  };

const section = (page: Page) => page.getByRole("region", { name: "Promotion policies" });
const row = (page: Page, text: RegExp) => section(page).getByRole("row").filter({ hasText: text });

const openReleases = async (page: Page, app: MockBackend) => {
  await page.goto(app.url);
  await page.getByRole("link", { name: "Releases" }).click();
  await expect(page.getByRole("heading", { name: "Promotion policies" })).toBeVisible();
};

test.describe("promotion policies", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("lists each policy, its reason, and instances without evidence", async ({ page }) => {
    app = await serveConsole(server({ ...FLEET, promotion_policies: POLICIES }));
    await openReleases(page, app);
    await expect(section(page).getByRole("row")).toHaveCount(POLICIES.length + 1);

    await expect(row(page, /dev -> candidate.*soaking/).first()).toContainText(
      "channel-promotion-policy:api/candidate v2",
    );
    const missing = row(page, /^api.*candidate -> stable/);
    await expect(missing).toContainText("instances without health evidence");
    await expect(
      missing.getByRole("list", { name: "Instances without evidence" }).getByRole("listitem"),
    ).toHaveText(["edge-1", "edge-2"]);
    await expect(row(page, /^billing/)).toContainText("paused");
    await expect(row(page, /^web.*dev -> candidate/)).toContainText("promoted");
    const reset = row(page, /^web.*candidate -> stable/);
    await expect(reset.getByRole("cell", { name: "reset", exact: true })).toBeVisible();
    await expect(
      reset.getByRole("cell", { name: "health evidence failed on edge-3", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath("promotion-policies.png"),
      fullPage: true,
    });
    await expectDesignRules(page);
    // Read-only: nothing but reads, and none of them to a policy route.
    expect(app.sent.every((sent) => sent.method === "GET")).toBe(true);
  });

  test("says when there is no policy", async ({ page }) => {
    app = await serveConsole(server(FLEET));
    await openReleases(page, app);
    await expect(section(page)).toContainText("No promotion policies.");
    await expect(section(page).getByRole("table")).toHaveCount(0);
    await expectDesignRules(page);
  });

  test("says an older server does not report policies", async ({ page }) => {
    app = await serveConsole(server(FLEET, HEALTHZ));
    await openReleases(page, app);
    await expect(section(page)).toContainText("This server does not report promotion policies.");
    await page.screenshot({
      path: test.info().outputPath("promotion-policies-older-server.png"),
      fullPage: true,
    });
    await expectDesignRules(page);
  });
});

const detail = (page: Page) => page.getByRole("region", { name: "Policy detail" });
const rules = (page: Page) => detail(page).getByRole("definition");
const MANAGER = ["read", "publish", "management"];

const openDetail = async (page: Page, product: string, target: string) => {
  await section(page)
    .getByRole("button", { name: `Detail ${product} ${target}` })
    .click();
  await expect(detail(page).getByRole("term").first()).toHaveText("Policy");
};

test.describe("promotion policy detail", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("shows soak progress, rules, and offers pause to management", async ({ page }) => {
    app = await serveConsole(server({ ...FLEET, promotion_policies: POLICIES }, CAPABLE, MANAGER));
    await openReleases(page, app);
    await openDetail(page, "api", "candidate");
    await expect(rules(page)).toContainText([
      "channel-promotion-policy:api/candidate v2",
      "1h",
      "health SLO · healthy >= 95% · failing <= 5%",
      "off, a failing soak only resets",
      "no",
      "api@1.4.0 · 12m of 1h · healthy 98% · failing 1%",
    ]);
    await expect(detail(page).getByRole("button", { name: "Pause" })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("policy-soaking.png"), fullPage: true });
    await expectDesignRules(page);
  });

  test("shows a recall rule that recalls on a failing soak", async ({ page }) => {
    app = await serveConsole(server({ ...FLEET, promotion_policies: POLICIES }));
    await openReleases(page, app);
    await openDetail(page, "api", "stable");
    await expect(rules(page).nth(3)).toHaveText("when failing > 5% of 1h soak");
    await page.screenshot({
      path: test.info().outputPath("policy-recall-rule.png"),
      fullPage: true,
    });
    await expectDesignRules(page);
  });

  test("renders a soak reset with its cause", async ({ page }) => {
    app = await serveConsole(server({ ...FLEET, promotion_policies: POLICIES }, CAPABLE, MANAGER));
    await openReleases(page, app);
    await openDetail(page, "web", "stable");
    await expect(rules(page).last()).toHaveText(
      "2026-11-14T10:05Z · health evidence failed on edge-3",
    );
    await page.screenshot({ path: test.info().outputPath("policy-reset.png"), fullPage: true });
    await expectDesignRules(page);
  });

  test("names the policy as the promoter", async ({ page }) => {
    app = await serveConsole(server({ ...FLEET, promotion_policies: POLICIES }));
    await openReleases(page, app);
    await openDetail(page, "web", "candidate");
    await expect(rules(page).last()).toHaveText("policy channel-promotion-policy:web/candidate");
  });

  test("shows who paused and resumes with one confirmed request", async ({ page }) => {
    app = await serveConsole(server({ ...FLEET, promotion_policies: POLICIES }, CAPABLE, MANAGER));
    let body: unknown;
    page.on("request", (request) => {
      if (request.method() === "POST") {
        body = request.postDataJSON();
      }
    });
    await openReleases(page, app);
    await openDetail(page, "billing", "stable");
    await expect(rules(page).nth(4)).toHaveText("by oidc:alice at 2026-11-14T09:30Z");
    await page.screenshot({ path: test.info().outputPath("policy-paused.png"), fullPage: true });
    await detail(page).getByRole("button", { name: "Resume" }).click();
    await detail(page)
      .getByRole("button", { name: "Resume billing candidate -> stable policy" })
      .click();
    await expect(detail(page).getByRole("status")).toHaveText("Resumed and audited.");
    expect(app.sent.filter((sent) => sent.method === "POST").map((sent) => sent.path)).toEqual([
      "/v1/products/billing/channels/stable/policy/resume",
    ]);
    expect(body).toEqual({ version: 1, operation: "channel_policy_resume" });
    await expectDesignRules(page);
  });

  test("offers no pause without the permission", async ({ page }) => {
    app = await serveConsole(server({ ...FLEET, promotion_policies: POLICIES }));
    await openReleases(page, app);
    await openDetail(page, "api", "candidate");
    await page.waitForLoadState("networkidle");
    await expect(detail(page).getByRole("button")).toHaveCount(0);
    await page.screenshot({
      path: test.info().outputPath("policy-no-permission.png"),
      fullPage: true,
    });
    await expectDesignRules(page);
  });

  test("a lost pause response reads as unknown and is sent once", async ({ page }) => {
    app = await serveConsole(server({ ...FLEET, promotion_policies: POLICIES }, CAPABLE, MANAGER));
    let attempts = 0;
    await page.route("**/policy/pause", async (route) => {
      attempts += 1;
      await route.abort("connectionreset");
    });
    await openReleases(page, app);
    await openDetail(page, "api", "candidate");
    await detail(page).getByRole("button", { name: "Pause" }).click();
    await detail(page).getByRole("button", { name: "Pause api dev -> candidate policy" }).click();
    await expect(detail(page).getByRole("status")).toHaveText(/outcome is unknown/);
    await page.waitForLoadState("networkidle");
    expect(attempts).toBe(1);
    await expect(detail(page).getByRole("status")).not.toHaveText(/audited/);
    await page.screenshot({ path: test.info().outputPath("policy-lost.png"), fullPage: true });
    await expectDesignRules(page);
  });

  test("a refusal hides the server's text", async ({ page }) => {
    app = await serveConsole(
      server({ ...FLEET, promotion_policies: POLICIES }, CAPABLE, MANAGER, {
        status: 409,
        body: { error: "internal detail at store.rs:42" },
      }),
    );
    await openReleases(page, app);
    await openDetail(page, "api", "candidate");
    await detail(page).getByRole("button", { name: "Pause" }).click();
    await detail(page).getByRole("button", { name: "Pause api dev -> candidate policy" }).click();
    await expect(detail(page).getByRole("alert")).toHaveText("Pause refused.");
    await expectDesignRules(page);
  });
});

test.describe("promotion policies on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  // The top bar already overflows a phone, so overflow is checked on this section only.
  test("keeps the section inside the viewport without leaking internals", async ({ page }) => {
    app = await serveConsole(server({ ...FLEET, promotion_policies: POLICIES }));
    await openReleases(page, app);
    await expect(row(page, /^billing/)).toBeVisible();
    const box = await section(page).boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
    await page.screenshot({
      path: test.info().outputPath("promotion-policies-phone.png"),
      fullPage: true,
    });
    expect(await page.locator("body").textContent()).not.toMatch(
      /\bADR\b|#\d+|HTTP \d{3}|\/v1\/|\bat \w+ \(|Error:|—/,
    );
  });
});
