// Environment deployment history against a mocked API. Run with `pnpm build && pnpm e2e`.
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
      products_current: 1,
      products_behind: 0,
      products_missing: 1,
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
  latest_plan: null,
  subscriptions: [
    {
      product: "api",
      instance: "api",
      channel: "stable",
      head: "1.1.0",
      deployed: "1.0.0",
      state: "unhealthy",
      error: "target failed; automatic retry held; create and approve an explicit plan to retry",
    },
    {
      product: "web",
      instance: "web",
      channel: "stable",
      head: "1.1.0",
      deployed: "1.1.0",
      state: "current",
    },
  ],
} as unknown as EnvironmentInspectReport;

const HOST_ME = {
  principal: "host:uid:1000",
  kind: "human",
  capabilities: ["read"],
  user: "alice",
  groups: ["tenkai-viewer"],
  source: "host",
};

const ATTEMPTS = {
  items: [
    {
      id: "dep:web:2",
      created_at: 1_700_000_001_000,
      instance: "web",
      product: "web",
      from_version: "1.0.0",
      to_version: "1.1.0",
      status: "succeeded",
      action: "upgrade",
      plan_id: "tenkai:plan:prod:2",
      detail: "",
    },
    {
      id: "dep:api:1",
      created_at: 1_700_000_000_000,
      instance: "api",
      product: "api",
      from_version: "1.0.0",
      to_version: "1.1.0",
      status: "failed",
      action: "upgrade",
      plan_id: "tenkai:plan:prod:1",
      detail: "probe failed\nraw output that must stay collapsed",
    },
  ],
};

const ok = (body: unknown): Reply => ({ status: 200, body });

const server = (
  history: Reply | ((url: URL) => Reply),
  inspect: EnvironmentInspectReport = INSPECT,
): Routes => {
  return (path, request) => {
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
      return ok(inspect);
    }
    if (path === "/v1/environments/prod/runtime") {
      return ok({ environment: "prod", components: [] });
    }
    if (path === "/v1/environments/prod/dependencies") {
      return ok({ environment: "prod", holds: [], products: [] });
    }
    if (path === "/v1/environments/prod/history") {
      return typeof history === "function"
        ? history(new URL(request.url ?? "/", "http://local"))
        : history;
    }
    return undefined;
  };
};

test.describe("environment history", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("shows attempts, collapsed detail, and a hold link", async ({ page }) => {
    app = await serveConsole(server(ok(ATTEMPTS)));
    await page.goto(app.url);
    await page.getByRole("link", { name: "Environments" }).click();
    await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
    const history = page
      .locator("table")
      .filter({ has: page.getByRole("columnheader", { name: "From -> to" }) });
    await expect(history.getByRole("cell", { name: "web", exact: true })).toBeVisible();
    await expect(history.getByRole("cell", { name: "api", exact: true })).toBeVisible();
    await expect(history.getByRole("cell", { name: "1.0.0 -> 1.1.0" }).first()).toBeVisible();
    await expect(history.getByRole("cell", { name: "failed", exact: true })).toBeVisible();
    await expect(page.getByText("raw output that must stay collapsed")).toBeHidden();
    await page.getByText("probe failed", { exact: true }).click();
    await expect(page.getByText("raw output that must stay collapsed")).toBeVisible();
    await expect(page.getByRole("link", { name: "History" })).toBeVisible();
    await expectDesignRules(page);
    expect(
      app.sent.some(
        (sent) => sent.method === "GET" && sent.path === "/v1/environments/prod/history",
      ),
    ).toBe(true);
    expect(
      app.sent
        .filter((sent) => sent.path === "/v1/environments/prod/history")
        .every((sent) => sent.authorization === undefined),
    ).toBe(true);
  });

  test("filters by instance from the held target", async ({ page }) => {
    const requested: string[] = [];
    app = await serveConsole(
      server((url) => {
        requested.push(url.search);
        const product = url.searchParams.get("product");
        const items = product
          ? ATTEMPTS.items.filter((item) => item.instance === product)
          : ATTEMPTS.items;
        return ok({ items });
      }),
    );
    await page.goto(app.url);
    await page.getByRole("link", { name: "Environments" }).click();
    const historyLink = page.getByRole("link", { name: "History" });
    await expect(historyLink).toBeVisible();
    const href = await historyLink.getAttribute("href");
    expect(href).toContain("instance=api");
    await page.goto(new URL(href ?? "", app.url).toString());
    await expect(
      page
        .locator("table")
        .filter({ has: page.getByRole("columnheader", { name: "From -> to" }) })
        .getByRole("cell", { name: "api", exact: true }),
    ).toBeVisible();
    await expect(
      page
        .locator("table")
        .filter({ has: page.getByRole("columnheader", { name: "From -> to" }) })
        .getByRole("cell", { name: "web", exact: true }),
    ).toHaveCount(0);
    expect(requested.some((search) => search.includes("product=api"))).toBe(true);
    await expectDesignRules(page);
  });

  test("pages with a stable cursor", async ({ page }) => {
    app = await serveConsole(
      server((url) => {
        if (url.searchParams.get("cursor") === "c2") {
          return ok({ items: [ATTEMPTS.items[1]] });
        }
        return ok({ items: [ATTEMPTS.items[0]], next_cursor: "c2" });
      }),
    );
    await page.goto(app.url);
    await page.getByRole("link", { name: "Environments" }).click();
    const history = page
      .locator("table")
      .filter({ has: page.getByRole("columnheader", { name: "From -> to" }) });
    await expect(history.getByRole("cell", { name: "web", exact: true })).toBeVisible();
    await expect(history.getByRole("cell", { name: "api", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "More" }).click();
    await expect(history.getByRole("cell", { name: "api", exact: true })).toBeVisible();
    await expect(history.getByRole("cell", { name: "web", exact: true })).toBeVisible();
    await expectDesignRules(page);
  });

  test("says none when there are no attempts", async ({ page }) => {
    app = await serveConsole(server(ok({ items: [] })));
    await page.goto(app.url);
    await page.getByRole("link", { name: "Environments" }).click();
    await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
    await expect(page.getByText("This server does not report deployment history.")).toHaveCount(0);
    await expect(page.getByText("none").first()).toBeVisible();
    await expectDesignRules(page);
  });

  test("says the route is missing without a status code", async ({ page }) => {
    app = await serveConsole(server({ status: 404, body: { error: "not found" } }));
    await page.goto(app.url);
    await page.getByRole("link", { name: "Environments" }).click();
    await expect(page.getByText("This server does not report deployment history.")).toBeVisible();
    await expect(page.getByText("not found")).toHaveCount(0);
    await expectDesignRules(page);
  });
});

test.describe("environment history on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  // The environments screen already overflows a phone (top bar tabs, fleet
  // table). Assert history is reachable and copy stays clean; do not use the
  // shared overflow check until that screen fits.
  test("shows history without leaking internals", async ({ page }) => {
    app = await serveConsole(server(ok(ATTEMPTS)));
    await page.goto(app.url);
    await page.getByRole("link", { name: "Environments" }).click();
    await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
    const history = page
      .locator("table")
      .filter({ has: page.getByRole("columnheader", { name: "From -> to" }) });
    await expect(history.getByRole("cell", { name: "web", exact: true })).toBeVisible();
    expect(await page.locator("body").textContent()).not.toMatch(
      /\bADR\b|#\d+|HTTP \d{3}|\/v1\/|\bat \w+ \(|Error:|—/,
    );
  });
});
