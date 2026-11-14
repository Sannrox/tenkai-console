// Owners, endpoints and raw webhook deliveries against a mocked API. Run with `pnpm build && pnpm e2e`.
import { type Page, expect, test } from "@playwright/test";
import type {
  EnvironmentInspectReport,
  FleetEnvironmentRow,
  FleetStatusReport,
  OwnerView,
  WebhookDelivery,
  WebhookEndpoint,
} from "../src/api/tenkai.gen";
import { type MockBackend, type Reply, expectDesignRules, serveConsole } from "./mock-backend";

const ok = (body: unknown): Reply => ({ status: 200, body });

const OWNER: OwnerView = {
  contact: "ops@example.test",
  endpoints: ["https://hooks.example.test/a"],
};
const HOOK: WebhookEndpoint = { url: "https://hooks.example.test/a", secret_env: "HOOK_SECRET" };
const HOOK_B: WebhookEndpoint = { url: "https://hooks.example.test/b", secret_env: "HOOK_SECRET" };

// Verdicts as environment inspect types them (Tenkai #1279).
const REACHABLE: OwnerView = {
  ...OWNER,
  reachability: {
    verdict: "reachable",
    endpoints: [
      {
        url: "https://hooks.example.test/a",
        verdict: "reachable",
        consecutive_failures: 0,
        last_success_at: Date.UTC(2026, 10, 14, 11),
      },
    ],
  },
};
const UNREACHABLE: OwnerView = {
  ...OWNER,
  reachability: {
    verdict: "unreachable",
    endpoints: [
      {
        url: "https://hooks.example.test/a",
        verdict: "unreachable",
        consecutive_failures: 5,
        last_success_at: Date.UTC(2026, 10, 13, 9),
      },
    ],
  },
};
const UNCONFIGURED_OWNER: OwnerView = {
  contact: "ops@example.test",
  endpoints: [],
  reachability: { verdict: "unconfigured", endpoints: [] },
};

const RETRYING: WebhookDelivery = {
  id: "d1",
  event: "apply.failed",
  url: "https://hooks.example.test/a",
  state: "retrying",
  attempts: 3,
  next_attempt_at: Date.UTC(2026, 10, 14, 12),
  last_error: "connection refused",
};

// The server adds this row when the owner has no endpoint; its state is not in the contract.
const UNCONFIGURED: WebhookDelivery = {
  id: "tenkai:owner-unconfigured:prod",
  event: "owner.unconfigured",
  url: "",
  state: "unconfigured",
  attempts: 0,
  next_attempt_at: 0,
  last_error: "owner ops@example.test has no notification endpoint",
};

const fleetRow = (owner?: string): FleetEnvironmentRow => ({
  id: "env:prod",
  name: "prod",
  description: "fixture",
  subscription_count: 1,
  products_current: 1,
  products_behind: 0,
  products_missing: 0,
  unhealthy: false,
  health_summary: "ok",
  lease_held: false,
  posture: "current",
  ...(owner === undefined ? {} : { owner }),
});

const fleet = (owner?: string): FleetStatusReport => ({
  environments: [fleetRow(owner)],
  environment_count: 1,
  environments_current: 1,
  environments_behind: 0,
  environments_unhealthy: 0,
  environments_empty: 0,
});

const SUBSCRIPTION = {
  product: "api",
  instance: "api",
  channel: "stable",
  head: "1.1.0",
  deployed: "1.1.0",
  state: "current",
  health: "healthy",
};

type Fixture = {
  owner?: OwnerView;
  webhooks?: WebhookEndpoint[];
  deliveries?: Reply;
  /** Answer to a PUT or DELETE on the environment owner route. */
  write?: Reply;
  productOwner?: OwnerView | null;
  productWebhooks?: WebhookEndpoint[];
  productWrite?: Reply;
};

const inspect = ({ owner, webhooks }: Fixture) =>
  ({
    id: "env:prod",
    name: "prod",
    description: "fixture",
    execution_note: "",
    facts: {},
    lease: { held: true, status: "held", generation: 7 },
    latest_plan: null,
    subscriptions: [SUBSCRIPTION],
    ...(owner === undefined ? {} : { owner }),
    ...(webhooks === undefined ? {} : { webhooks }),
  }) as unknown as EnvironmentInspectReport;

const serve = (fixture: Fixture) =>
  serveConsole((path, request) => {
    const method = request.method ?? "GET";
    if (path === "/v1/auth/oidc") {
      return { status: 404, body: { error: "no oidc client" } };
    }
    if (path === "/v1/auth/me") {
      return ok({
        principal: "host:uid:1000",
        kind: "human",
        capabilities: ["read", "management"],
        user: "alice",
        source: "host",
      });
    }
    if (path === "/v1/fleet/status") {
      return ok(fleet(fixture.owner?.contact));
    }
    if (path === "/v1/environments") {
      return ok([{ id: "env:prod", name: "prod", description: "fixture" }]);
    }
    if (path === "/v1/channels") {
      return ok({ items: [{ id: "c", name: "stable", product: "api", head: "api@1.1.0" }] });
    }
    if (path === "/v1/events") {
      return ok({ events: [], next_cursor: "0" });
    }
    if (path === "/v1/environments/prod") {
      return ok(inspect(fixture));
    }
    if (path === "/v1/environments/prod/status") {
      return ok([{ ...SUBSCRIPTION, owner: "api-team@example.test" }]);
    }
    if (path === "/v1/environments/prod/history") {
      return ok({ items: [], ...(fixture.owner ? { owner: fixture.owner } : {}) });
    }
    if (path === "/v1/environments/prod/webhooks/deliveries") {
      return fixture.deliveries ?? ok([]);
    }
    if (path === "/v1/environments/prod/owner" && method !== "GET") {
      return fixture.write ?? ok({ version: 1, operation: "configure", message: "set prod owner" });
    }
    if (path === "/v1/products/api/owner") {
      return method === "GET"
        ? ok(fixture.productOwner ?? null)
        : (fixture.productWrite ?? ok(OWNER));
    }
    if (path === "/v1/products/api/webhooks") {
      return method === "GET"
        ? ok(fixture.productWebhooks ?? [])
        : (fixture.productWrite ?? ok("cleared api webhooks"));
    }
    return undefined;
  });

const owner = (page: Page) => page.getByRole("region", { name: "Owner" });

const open = async (page: Page, app: MockBackend) => {
  const deliveries = page.waitForResponse((response) =>
    response.url().endsWith("/webhooks/deliveries"),
  );
  await page.goto(app.url);
  await page.getByRole("link", { name: "Environments" }).click();
  await expect(owner(page)).toBeVisible();
  await deliveries;
  await expect(owner(page)).not.toContainText("Loading");
};

const openReleases = async (page: Page, app: MockBackend) => {
  await page.goto(app.url);
  await page.getByRole("link", { name: "Releases" }).click();
  await expect(page.getByRole("table", { name: "Product owners" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Product owners" })).not.toContainText("Loading");
};

const capture = (page: Page, name: string) =>
  page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });

const writes = (app: MockBackend) => app.sent.filter((sent) => sent.method !== "GET");

test.describe("owners and notification routing", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("no owner and no webhooks is flagged; no deliveries", async ({ page }) => {
    app = await serve({});
    await open(page, app);
    await expect(owner(page).getByLabel("Owner routing")).toHaveText("No owner and no webhooks");
    await expect(owner(page)).toContainText("contactnone");
    await expect(owner(page).getByRole("table", { name: "Webhook deliveries" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Environments" })).not.toContainText("ops@");
    await capture(page, "owner-none");
    await expectDesignRules(page);
  });

  test("owner set shows on the page, status, history and fleet", async ({ page }) => {
    app = await serve({ owner: OWNER, webhooks: [HOOK] });
    await open(page, app);
    await expect(owner(page).getByLabel("Owner routing")).toHaveCount(0);
    await expect(owner(page)).toContainText("ops@example.test");
    await expect(owner(page)).toContainText("https://hooks.example.test/a");
    await expect(owner(page)).toContainText("api-team@example.test");
    await expect(page.getByLabel("History owner")).toHaveText("owner ops@example.test");
    await expect(
      page.getByRole("row", { name: /prod/ }).filter({ hasText: "ops@example.test" }).first(),
    ).toBeVisible();
    await capture(page, "owner-set");
    await expectDesignRules(page);
    expect(writes(app)).toStrictEqual([]);
  });

  test("a retrying delivery shows attempts, next attempt and last error by URL", async ({
    page,
  }) => {
    app = await serve({ owner: OWNER, webhooks: [HOOK], deliveries: ok([UNCONFIGURED, RETRYING]) });
    await open(page, app);
    const rows = owner(page).getByRole("table", { name: "Webhook deliveries" }).getByRole("row");
    await expect(rows.nth(1)).toContainText("unconfigured");
    await expect(rows.nth(1)).toContainText("has no notification endpoint");
    await expect(rows.nth(2)).toContainText("https://hooks.example.test/a");
    await expect(rows.nth(2)).toContainText("retrying");
    await expect(rows.nth(2)).toContainText("3");
    await expect(rows.nth(2)).toContainText("2026-11-14T12:00:00.000Z");
    await expect(rows.nth(2)).toContainText("connection refused");
    await capture(page, "owner-retrying");
    await expectDesignRules(page);
  });

  test("owner reachable shows each endpoint's verdict and last success", async ({ page }) => {
    app = await serve({ owner: REACHABLE, webhooks: [HOOK] });
    await open(page, app);
    await expect(owner(page).getByLabel("Owner reachability")).toHaveText("reachable");
    const rows = owner(page).getByRole("table", { name: "Endpoint reachability" }).getByRole("row");
    await expect(rows.nth(1)).toHaveText(
      /https:\/\/hooks\.example\.test\/areachable02026-11-14T11:00:00\.000Z/,
    );
    await capture(page, "owner-reachable");
    await expectDesignRules(page);
  });

  test("owner unreachable is flagged with failures and last success", async ({ page }) => {
    app = await serve({ owner: UNREACHABLE, webhooks: [HOOK], deliveries: ok([RETRYING]) });
    await open(page, app);
    await expect(owner(page).getByLabel("Owner reachability")).toHaveText("unreachable");
    await expect(owner(page).getByLabel("Owner reachability")).toHaveClass(/text-danger/);
    const rows = owner(page).getByRole("table", { name: "Endpoint reachability" }).getByRole("row");
    await expect(rows.nth(1)).toHaveText(
      /https:\/\/hooks\.example\.test\/aunreachable52026-11-13T09:00:00\.000Z/,
    );
    await capture(page, "owner-unreachable");
    await expectDesignRules(page);
  });

  test("owner unconfigured reads unconfigured with no endpoint rows", async ({ page }) => {
    app = await serve({ owner: UNCONFIGURED_OWNER, deliveries: ok([UNCONFIGURED]) });
    await open(page, app);
    await expect(owner(page).getByLabel("Owner reachability")).toHaveText("unconfigured");
    await expect(owner(page).getByRole("table", { name: "Endpoint reachability" })).toHaveCount(0);
    await capture(page, "owner-unconfigured");
    await expectDesignRules(page);
  });

  test("a server without verdicts shows none and the console infers none", async ({ page }) => {
    app = await serve({ owner: OWNER, webhooks: [HOOK], deliveries: ok([RETRYING]) });
    await open(page, app);
    await expect(owner(page).getByLabel("Owner reachability")).toHaveCount(0);
    await expect(owner(page).getByRole("table", { name: "Endpoint reachability" })).toHaveCount(0);
  });

  test("tenant mode reads unavailable without the server's text", async ({ page }) => {
    app = await serve({
      deliveries: {
        status: 503,
        body: { error: "remote catalog lifecycle is not available in tenant mode" },
      },
    });
    await open(page, app);
    await expect(owner(page)).toContainText("This server does not report webhook deliveries.");
    await expect(owner(page)).not.toContainText("tenant mode");
    await expectDesignRules(page);
  });

  test("set owner sends one PUT with the reason and the generation shown", async ({ page }) => {
    app = await serve({});
    let body: unknown;
    page.on("request", (request) => {
      if (request.url().endsWith("/v1/environments/prod/owner")) {
        body = request.postDataJSON();
      }
    });
    await open(page, app);
    await owner(page).getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Owner contact").fill(" ops@example.test ");
    await page.getByLabel("Owner reason").fill("handover");
    await owner(page).getByRole("button", { name: "Set", exact: true }).click();
    await page.getByRole("button", { name: "Set owner ops@example.test" }).click();
    await expect(page.getByRole("status").filter({ hasText: "set prod owner" })).toBeVisible();
    expect(writes(app).map((sent) => [sent.method, sent.path])).toStrictEqual([
      ["PUT", "/v1/environments/prod/owner"],
    ]);
    expect(body).toStrictEqual({
      version: 1,
      operation: "configure",
      environment: "prod",
      expected_generation: 7,
      reason: "handover",
      change: { kind: "set_owner", contact: "ops@example.test" },
    });
  });

  test("a lost response reads as unknown and is not retried", async ({ page }) => {
    app = await serve({ owner: OWNER, webhooks: [HOOK] });
    let attempts = 0;
    await page.route("**/v1/environments/prod/owner", async (route) => {
      attempts += 1;
      await route.abort("connectionreset");
    });
    await open(page, app);
    await owner(page).getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Owner reason").fill("leaving");
    await owner(page).getByRole("button", { name: "Clear", exact: true }).click();
    await page.getByRole("button", { name: "Clear the owner" }).click();
    await expect(page.getByRole("status").filter({ hasText: /outcome is unknown/ })).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(attempts).toBe(1);
    await expectDesignRules(page);
  });

  test("no permission: deliveries read no access and a refusal hides Edit", async ({ page }) => {
    app = await serve({
      owner: OWNER,
      deliveries: { status: 403, body: { error: "forbidden" } },
      write: { status: 403, body: { error: "insufficient delivery capability" } },
    });
    await open(page, app);
    await expect(owner(page)).toContainText("No access");
    await owner(page).getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Owner reason").fill("leaving");
    await owner(page).getByRole("button", { name: "Clear", exact: true }).click();
    await page.getByRole("button", { name: "Clear the owner" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "missing management" })).toBeVisible();
    await expect(owner(page).getByRole("button", { name: "Edit" })).toHaveCount(0);
    await capture(page, "owner-forbidden");
    await expectDesignRules(page);
  });
});

test.describe("product owners", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("shows owner and endpoints, and sets an owner with one PUT", async ({ page }) => {
    app = await serve({ productOwner: null, productWebhooks: [HOOK] });
    let body: unknown;
    page.on("request", (request) => {
      if (request.url().endsWith("/v1/products/api/owner") && request.method() === "PUT") {
        body = request.postDataJSON();
      }
    });
    await openReleases(page, app);
    const table = page.getByRole("table", { name: "Product owners" });
    await expect(table).toContainText("none");
    await expect(table).toContainText("https://hooks.example.test/a");
    await capture(page, "product-owners");
    await page.getByLabel("Product owner contact").fill("ops@example.test");
    await page.getByRole("button", { name: "Set owner" }).click();
    await page.getByRole("button", { name: "Set api owner ops@example.test" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "owner ops@example.test" }),
    ).toBeVisible();
    expect(writes(app).map((sent) => [sent.method, sent.path])).toStrictEqual([
      ["PUT", "/v1/products/api/owner"],
    ]);
    expect(body).toStrictEqual({ contact: "ops@example.test" });
    await expectDesignRules(page);
  });

  test("remove all webhooks is one DELETE without a body", async ({ page }) => {
    app = await serve({ productOwner: OWNER, productWebhooks: [HOOK] });
    await openReleases(page, app);
    await page.getByRole("button", { name: "Remove all webhooks" }).click();
    await page.getByRole("button", { name: "Remove all 1 api webhooks" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "cleared api webhooks" }),
    ).toBeVisible();
    expect(writes(app).map((sent) => [sent.method, sent.path])).toStrictEqual([
      ["DELETE", "/v1/products/api/webhooks"],
    ]);
  });
});

test.describe("remove one product endpoint", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  const pick = async (page: Page) => {
    await page.getByRole("button", { name: HOOK_B.url, exact: true }).click();
    await page.getByRole("button", { name: "Remove webhook", exact: true }).click();
    await page.getByRole("button", { name: `Remove api webhook ${HOOK_B.url}` }).click();
  };

  test("is one DELETE naming that URL", async ({ page }) => {
    app = await serve({
      productOwner: OWNER,
      productWebhooks: [HOOK, HOOK_B],
      productWrite: ok("removed api webhook"),
    });
    await openReleases(page, app);
    await expect(page.getByRole("button", { name: "Remove webhook", exact: true })).toHaveCount(0);
    await pick(page);
    await expect(page.getByRole("status").filter({ hasText: "removed api webhook" })).toBeVisible();
    expect(writes(app).map((sent) => [sent.method, sent.path, sent.search])).toStrictEqual([
      ["DELETE", "/v1/products/api/webhooks", `?url=${encodeURIComponent(HOOK_B.url)}`],
    ]);
    await capture(page, "product-endpoint-removed");
    await expectDesignRules(page);
  });

  test("a lost response reads as unknown and is not retried", async ({ page }) => {
    app = await serve({ productOwner: OWNER, productWebhooks: [HOOK, HOOK_B] });
    let attempts = 0;
    await page.route("**/v1/products/api/webhooks?url=*", async (route) => {
      attempts += 1;
      await route.abort("connectionreset");
    });
    await openReleases(page, app);
    await pick(page);
    await expect(page.getByRole("status").filter({ hasText: /outcome is unknown/ })).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(attempts).toBe(1);
    await expectDesignRules(page);
  });
});

test.describe("owners on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("the owner section stays inside the viewport", async ({ page }) => {
    app = await serve({ owner: UNREACHABLE, webhooks: [HOOK], deliveries: ok([RETRYING]) });
    await open(page, app);
    await owner(page).scrollIntoViewIfNeeded();
    await capture(page, "owner-phone");
    // The top navigation overflows a phone on every screen today; hold this
    // section to the viewport and the copy rules.
    const box = await owner(page).boundingBox();
    expect((box?.x ?? 0) + (box?.width ?? Infinity)).toBeLessThanOrEqual(390);
    expect(await page.locator("body").textContent()).not.toMatch(
      /\bADR\b|#\d+|HTTP \d{3}|\/v1\/|\bat \w+ \(|Error:|—/,
    );
  });
});
