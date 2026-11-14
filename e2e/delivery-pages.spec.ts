import type { IncomingMessage } from "node:http";
// Paged webhook delivery lists against a mocked API: a partial list says so
// everywhere it counts, loads the next page only on request, and appends
// without duplicates. Run with `pnpm build && pnpm e2e`.
import { type Page, expect, test } from "@playwright/test";
import type {
  EnvironmentInspectReport,
  FleetStatusReport,
  WebhookDelivery,
  WebhookDeliveryPage,
} from "../src/api/tenkai.gen";
import { type MockBackend, type Reply, expectDesignRules, serveConsole } from "./mock-backend";

const ok = (body: unknown): Reply => ({ status: 200, body });
const RAW = { status: 500, body: { error: "delivery store cursor decode panicked" } };

const PROD = { kind: "environment", name: "prod" } as const;
const API = { kind: "product", name: "api" } as const;

const failed = (id: string, sources: WebhookDelivery["sources"] = [PROD]): WebhookDelivery => ({
  id,
  event: "release.recalled",
  url: `https://hooks.example.test/${id}`,
  state: "retrying",
  attempts: 3,
  next_attempt_at: Date.UTC(2026, 10, 14, 12),
  last_error: "connection refused",
  sources,
});

const paged = (items: WebhookDelivery[], next_cursor?: string): Reply =>
  ok({
    items,
    ...(next_cursor === undefined ? {} : { next_cursor }),
  } satisfies WebhookDeliveryPage);

/** Answers by cursor: `""` is the first page; a function answers each ask in turn. */
type Pages = Record<string, Reply | ((asked: number) => Reply)>;

const SUBSCRIPTION = {
  product: "api",
  instance: "api",
  channel: "stable",
  head: "1.1.0",
  deployed: "1.1.0",
  state: "current",
  health: "healthy",
};

const serve = (fixture: { deliveries?: Pages; productDeliveries?: Pages }) => {
  const fleet: FleetStatusReport = {
    environments: [
      {
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
        owner: "ops@example.test",
      },
    ],
    environment_count: 1,
    environments_current: 1,
    environments_behind: 0,
    environments_unhealthy: 0,
    environments_empty: 0,
  };
  const asked = new Map<string, number>();
  const answer = (pages: Pages, request: IncomingMessage): Reply => {
    const cursor = new URL(request.url ?? "/", "http://local").searchParams.get("cursor") ?? "";
    const reply = pages[cursor] ?? { status: 404, body: { error: "not found" } };
    const count = (asked.get(cursor) ?? 0) + 1;
    asked.set(cursor, count);
    return typeof reply === "function" ? reply(count) : reply;
  };
  return serveConsole((path, request) => {
    if (path === "/v1/auth/oidc") {
      return { status: 404, body: { error: "no oidc client" } };
    }
    if (path === "/v1/auth/me") {
      return ok({
        principal: "host:uid:1000",
        kind: "human",
        capabilities: ["read"],
        user: "alice",
        source: "host",
      });
    }
    if (path === "/v1/fleet/status") {
      return ok(fleet);
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
      return ok({
        id: "env:prod",
        name: "prod",
        description: "fixture",
        execution_note: "",
        facts: {},
        lease: { held: true, status: "held", generation: 7 },
        latest_plan: null,
        subscriptions: [SUBSCRIPTION],
        owner: { contact: "ops@example.test", endpoints: [] },
      } as unknown as EnvironmentInspectReport);
    }
    if (path === "/v1/environments/prod/status") {
      return ok([{ ...SUBSCRIPTION, owner: "api-team@example.test" }]);
    }
    if (path === "/v1/environments/prod/history") {
      return ok({ items: [] });
    }
    if (path === "/v1/environments/prod/webhooks/deliveries") {
      return answer(fixture.deliveries ?? { "": ok([]) }, request);
    }
    if (path === "/v1/products/api/owner") {
      return ok({ contact: "api-team@example.test", endpoints: [] });
    }
    if (path === "/v1/products/api/webhooks") {
      return ok([]);
    }
    if (path === "/v1/products/api/webhooks/deliveries") {
      return answer(fixture.productDeliveries ?? {}, request);
    }
    return undefined;
  });
};

const owner = (page: Page) => page.getByRole("region", { name: "Owner" });
const deliveryRows = (page: Page) =>
  owner(page).getByRole("table", { name: "Webhook deliveries" }).locator("tbody tr");
const failureCount = (page: Page) =>
  page.getByRole("table", { name: "Delivery failures" }).locator("tbody tr td.text-danger");
const partial = (page: Page) => page.getByLabel("Deliveries partial");
const failuresPartial = (page: Page) => page.getByLabel("Delivery failures partial");
const moreFailed = (page: Page) =>
  page.getByRole("alert").filter({ hasText: "Could not load more" });
const loadMore = (page: Page) => page.getByRole("button", { name: "Load more" });
const asked = (app: MockBackend, path: string) =>
  app.sent.filter((sent) => sent.path.endsWith(path)).map((sent) => sent.search);

const openEnvironment = async (page: Page, app: MockBackend) => {
  const deliveries = page.waitForResponse((response) =>
    response.url().endsWith("/environments/prod/webhooks/deliveries"),
  );
  await page.goto(app.url);
  await page.getByRole("link", { name: "Environments" }).click();
  await deliveries;
  await expect(owner(page)).toBeVisible();
  await expect(owner(page)).not.toContainText("Loading");
};

const capture = (page: Page, name: string) =>
  page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });

test.describe("paged delivery lists", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  let app: MockBackend;
  test.afterEach(async () => {
    // Paging is read only.
    expect(app.sent.filter((sent) => sent.method !== "GET")).toStrictEqual([]);
    await app.close();
  });

  test("one page claims nothing more", async ({ page }) => {
    app = await serve({ deliveries: { "": paged([failed("d2"), failed("d1")]) } });
    await openEnvironment(page, app);
    await expect(deliveryRows(page)).toHaveCount(2);
    await expect(failureCount(page)).toHaveText(["2"]);
    await expect(partial(page)).toHaveCount(0);
    await expect(failuresPartial(page)).toHaveCount(0);
    await expect(loadMore(page)).toHaveCount(0);
    await expectDesignRules(page);
  });

  test("several pages: partial until the last, appended on request without duplicates", async ({
    page,
  }) => {
    app = await serve({
      deliveries: {
        "": paged([failed("d5"), failed("d4")], "c1"),
        c1: paged([failed("d4"), failed("d3"), failed("d2")], "c2"),
        c2: paged([failed("d1")]),
      },
    });
    await openEnvironment(page, app);
    await expect(deliveryRows(page)).toHaveCount(2);
    await expect(partial(page)).toHaveText("newest 2 shown, more exist");
    await expect(failuresPartial(page)).toHaveText("in the newest 2 deliveries, more exist");
    await capture(page, "environment-partial");
    // Nothing past the first page is read until asked.
    expect(asked(app, "/environments/prod/webhooks/deliveries")).toStrictEqual([""]);

    await loadMore(page).click();
    await expect(partial(page)).toHaveText("newest 4 shown, more exist");
    await expect(deliveryRows(page)).toHaveCount(4);
    await expect(failureCount(page)).toHaveText(["4"]);

    await loadMore(page).click();
    await expect(deliveryRows(page)).toHaveCount(5);
    await expect(failureCount(page)).toHaveText(["5"]);
    await expect(partial(page)).toHaveCount(0);
    await expect(failuresPartial(page)).toHaveCount(0);
    await expect(loadMore(page)).toHaveCount(0);
    expect(asked(app, "/environments/prod/webhooks/deliveries")).toStrictEqual([
      "",
      "?cursor=c1",
      "?cursor=c2",
    ]);
    await capture(page, "environment-complete");
    await expectDesignRules(page);
  });

  test("a next page that fails keeps what is shown and can be asked again", async ({ page }) => {
    app = await serve({
      deliveries: {
        "": paged([failed("d2")], "c1"),
        c1: (count) => (count === 1 ? RAW : paged([failed("d1")])),
      },
    });
    await openEnvironment(page, app);
    await loadMore(page).click();
    await expect(moreFailed(page)).toHaveText("Could not load more");
    await expect(deliveryRows(page)).toHaveCount(1);
    await expect(partial(page)).toHaveText("newest 1 shown, more exist");
    await expect(page.locator("body")).not.toContainText("panicked");
    await capture(page, "environment-more-failed");
    await expectDesignRules(page);

    await loadMore(page).click();
    await expect(deliveryRows(page)).toHaveCount(2);
    await expect(moreFailed(page)).toHaveCount(0);
    await expect(partial(page)).toHaveCount(0);
  });

  test("no permission reads as no access, with no partial claim", async ({ page }) => {
    app = await serve({ deliveries: { "": { status: 403, body: { error: "missing grant" } } } });
    await openEnvironment(page, app);
    await expect(owner(page)).toContainText("No access");
    await expect(partial(page)).toHaveCount(0);
    await expect(loadMore(page)).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("missing grant");
    await expectDesignRules(page);
  });

  test("an older server answering a bare array shows today's view", async ({ page }) => {
    app = await serve({ deliveries: { "": ok([failed("d2"), failed("d1")]) } });
    await openEnvironment(page, app);
    await expect(deliveryRows(page)).toHaveCount(2);
    await expect(partial(page)).toHaveCount(0);
    await expect(failuresPartial(page)).toHaveCount(0);
    await expect(loadMore(page)).toHaveCount(0);
  });

  test("product failures say they are partial and load more on request", async ({ page }) => {
    app = await serve({
      productDeliveries: {
        "": paged([failed("d3", [API]), failed("d2", [API])], "c1"),
        c1: (count) => (count === 1 ? RAW : paged([failed("d2", [API]), failed("d1", [API])])),
      },
    });
    const deliveries = page.waitForResponse((response) =>
      response.url().endsWith("/products/api/webhooks/deliveries"),
    );
    await page.goto(app.url);
    await page.getByRole("link", { name: "Releases" }).click();
    await deliveries;
    await expect(failureCount(page)).toHaveText(["2"]);
    await expect(failuresPartial(page)).toHaveText("in the newest 2 deliveries, more exist");
    await expect(partial(page)).toHaveText("newest 2 shown, more exist");

    await loadMore(page).click();
    await expect(moreFailed(page)).toHaveText("Could not load more deliveries of api");
    await expect(failureCount(page)).toHaveText(["2"]);
    await capture(page, "product-more-failed");
    await expectDesignRules(page);

    await loadMore(page).click();
    await expect(failureCount(page)).toHaveText(["3"]);
    await expect(failuresPartial(page)).toHaveCount(0);
    await expect(loadMore(page)).toHaveCount(0);
    expect(asked(app, "/products/api/webhooks/deliveries")).toStrictEqual([
      "",
      "?cursor=c1",
      "?cursor=c1",
    ]);
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("the partial line and Load more stay inside the page", async ({ page }) => {
    app = await serve({ deliveries: { "": paged([failed("d2"), failed("d1")], "c1") } });
    await openEnvironment(page, app);
    await loadMore(page).scrollIntoViewIfNeeded();
    await capture(page, "environment-partial-phone");
    for (const line of [partial(page), loadMore(page)]) {
      const box = await line.boundingBox();
      expect((box?.x ?? 0) + (box?.width ?? Infinity)).toBeLessThanOrEqual(390);
    }
  });
});
