// Live instance health against a mocked API. Run with `pnpm build && pnpm e2e`.
import { type Page, expect, test } from "@playwright/test";
import type { FleetEnvironmentRow, FleetStatusReport } from "../src/api/tenkai.gen";
import {
  type MockBackend,
  type Reply,
  type Routes,
  expectDesignRules,
  serveConsole,
} from "./mock-backend";

type Check = { name: string; state: string; message?: string };
/** `observed` is the status row's `health_observed_at_ms`; omitted as an older server would. */
type Instance = { name: string; health: string; checks?: Check[]; observed?: number };

const OBSERVED = Date.UTC(2026, 10, 14, 9, 12, 45);

const HOST_ME = {
  principal: "host:uid:1000",
  kind: "human",
  capabilities: ["read"],
  user: "alice",
  groups: ["tenkai-viewer"],
  source: "host",
};

const ok = (body: unknown): Reply => ({ status: 200, body });

const fleetRow = (name: string, health_summary: string): FleetEnvironmentRow => ({
  id: `env:${name}`,
  name,
  description: "fixture",
  subscription_count: 1,
  products_current: 1,
  products_behind: 0,
  products_missing: 0,
  unhealthy: health_summary !== "ok",
  health_summary,
  lease_held: false,
  posture: health_summary === "ok" ? "current" : "unhealthy",
});

/**
 * `prod` carries `instances`; `others` adds more fleet rows by health summary.
 * `status` overrides the status reply, as an older server would answer.
 */
const server = (
  instances: Instance[],
  summary: string,
  others: Array<[string, string]> = [],
  status?: Reply,
): Routes => {
  const rows = [
    fleetRow("prod", summary),
    ...others.map(([name, health]) => fleetRow(name, health)),
  ];
  const fleet: FleetStatusReport = {
    environments: rows,
    environment_count: rows.length,
    environments_current: rows.filter((row) => row.posture === "current").length,
    environments_behind: 0,
    environments_unhealthy: rows.filter((row) => row.unhealthy).length,
    environments_empty: 0,
  };
  const subscription = ({ name, health }: Instance) => ({
    product: name,
    instance: name,
    channel: "stable",
    head: "1.0.0",
    deployed: "1.0.0",
    state: "current",
    health,
  });
  return (path) => {
    if (path === "/v1/auth/oidc") {
      return { status: 404, body: { error: "no oidc client" } };
    }
    if (path === "/v1/auth/me") {
      return ok(HOST_ME);
    }
    if (path === "/v1/fleet/status") {
      return ok(fleet);
    }
    if (path === "/v1/environments") {
      return ok(rows.map((row) => ({ id: row.id, name: row.name, description: "fixture" })));
    }
    if (path === "/v1/channels") {
      return ok({ items: [] });
    }
    if (path === "/v1/environments/prod") {
      return ok({
        id: "env:prod",
        name: "prod",
        description: "fixture",
        execution_note: "",
        facts: {},
        lease: { held: false, status: "free" },
        latest_plan: null,
        subscriptions: instances.map(subscription),
      });
    }
    if (path === "/v1/environments/prod/status") {
      return (
        status ??
        ok(
          instances.map((instance) => ({
            ...subscription(instance),
            ...(instance.checks ? { health_checks: instance.checks } : {}),
            ...(instance.observed === undefined
              ? {}
              : { health_observed_at_ms: instance.observed }),
          })),
        )
      );
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
    return undefined;
  };
};

const instanceRow = (page: Page, name: string) =>
  page
    .locator("table")
    .filter({ has: page.getByRole("columnheader", { name: "Deployed" }) })
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name, exact: true }) });

const rollup = (page: Page) =>
  page.locator("dt", { hasText: /^health$/ }).locator("xpath=following-sibling::dd[1]");

/** Unhealthy and Unknown cells of the fleet roll-up on the delivery page. */
const fleetCounts = async (page: Page) => {
  const row = page
    .locator("table")
    .filter({ has: page.getByRole("columnheader", { name: "Unknown" }) })
    .getByRole("row")
    .nth(1);
  return { unhealthy: row.getByRole("cell").nth(3), unknown: row.getByRole("cell").nth(4) };
};

const capture = (page: Page, name: string) =>
  page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });

const FAILING: Instance[] = [
  {
    name: "api",
    health: "unhealthy",
    observed: OBSERVED,
    checks: [
      { name: "disk", state: "failing", message: "97% full on /var" },
      { name: "cert", state: "warning", message: "expires in 3 days" },
    ],
  },
  {
    name: "web",
    health: "healthy",
    checks: [{ name: "truncated", state: "warning", message: "probe output over 64 KiB" }],
  },
  { name: "worker", health: "healthy" },
];

test.describe("environment instance health", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("all healthy", async ({ page }) => {
    app = await serveConsole(
      server(
        [
          { name: "api", health: "healthy" },
          { name: "web", health: "healthy" },
        ],
        "ok",
      ),
    );
    await page.goto(app.url);
    const counts = await fleetCounts(page);
    await expect(counts.unknown).toHaveText("0");
    await page.getByRole("link", { name: "Environments" }).click();
    await expect(instanceRow(page, "api").getByRole("cell", { name: "healthy" })).toBeVisible();
    await expect(rollup(page)).toHaveText("2 healthy");
    // This server sends no observation time: none is shown.
    await expect(page.getByText(/^observed /)).toHaveCount(0);
    await capture(page, "health-all-healthy");
    await expectDesignRules(page);
    expect(app.sent.every((sent) => sent.method === "GET")).toBe(true);
  });

  test("failing checks with their messages; truncation reads as a warning", async ({ page }) => {
    app = await serveConsole(server(FAILING, "error"));
    await page.goto(app.url);
    const counts = await fleetCounts(page);
    await expect(counts.unhealthy).toHaveText("1");
    await expect(counts.unknown).toHaveText("0");
    await page.getByRole("link", { name: "Environments" }).click();
    const api = instanceRow(page, "api");
    await expect(api).toContainText("failing");
    await expect(api).toContainText("disk failing: 97% full on /var");
    await expect(api).toContainText("cert warning: expires in 3 days");
    const web = instanceRow(page, "web");
    await expect(web).toContainText("warning");
    await expect(web).toContainText("truncated warning: probe output over 64 KiB");
    await expect(rollup(page)).toHaveText("1 failing · 1 warning · 1 healthy");
    await capture(page, "health-failing-checks");
    await expectDesignRules(page);
    expect(app.sent.some((sent) => sent.path === "/v1/environments/prod/status")).toBe(true);
  });

  test("a stale report reads unknown, never healthy", async ({ page }) => {
    app = await serveConsole(
      server(
        [
          { name: "api", health: "unknown", observed: OBSERVED - 3_600_000 },
          { name: "web", health: "healthy", observed: OBSERVED },
        ],
        "unknown",
      ),
    );
    await page.goto(app.url);
    const counts = await fleetCounts(page);
    await expect(counts.unhealthy).toHaveText("0");
    await expect(counts.unknown).toHaveText("1");
    await page.getByRole("link", { name: "Environments" }).click();
    const api = instanceRow(page, "api");
    await expect(api.getByRole("cell", { name: "unknown", exact: true })).toBeVisible();
    await expect(api).not.toContainText("healthy");
    await expect(api).toContainText("observed 2026-11-14T08:12Z");
    await expect(instanceRow(page, "web")).toContainText("observed 2026-11-14T09:12Z");
    await expect(rollup(page)).toHaveText("1 unknown · 1 healthy");
    await capture(page, "health-stale");
    await expectDesignRules(page);
  });

  test("a repairing check is listed with the others", async ({ page }) => {
    app = await serveConsole(
      server(
        [
          {
            name: "api",
            health: "healthy",
            observed: OBSERVED,
            checks: [{ name: "pool", state: "repairing", message: "reconnecting to primary" }],
          },
          {
            name: "web",
            health: "unhealthy",
            observed: OBSERVED,
            checks: [
              { name: "disk", state: "failing", message: "97% full on /var" },
              { name: "cache", state: "repairing" },
            ],
          },
        ],
        "error",
      ),
    );
    await page.goto(app.url);
    await page.getByRole("link", { name: "Environments" }).click();
    const api = instanceRow(page, "api");
    await expect(api.getByRole("cell", { name: /^repairing/ })).toBeVisible();
    await expect(api).toContainText("pool repairing: reconnecting to primary");
    await expect(api).toContainText("observed 2026-11-14T09:12Z");
    const web = instanceRow(page, "web");
    await expect(web).toContainText("disk failing: 97% full on /var");
    await expect(web).toContainText("cache repairing");
    await expect(rollup(page)).toHaveText("1 failing · 1 repairing");
    await capture(page, "health-repairing");
    await expectDesignRules(page);
  });

  test("a healthy instance turns unknown on the next read, without a reload", async ({ page }) => {
    const fresh = server([{ name: "api", health: "healthy", observed: OBSERVED }], "ok");
    const stale = server([{ name: "api", health: "unknown", observed: OBSERVED }], "unknown");
    let reads = 0;
    app = await serveConsole((path, request) => {
      if (path === "/v1/environments/prod/status") {
        reads += 1;
        return (reads === 1 ? fresh : stale)(path, request);
      }
      return fresh(path, request);
    });
    await page.clock.install();
    await page.goto(app.url);
    await page.getByRole("link", { name: "Environments" }).click();
    await expect(rollup(page)).toHaveText("1 healthy");
    // Inspect already shows healthy; let the first status read settle so the
    // interval tick starts a new read instead of joining the one in flight.
    await expect.poll(() => reads).toBe(1);
    await page.waitForLoadState("networkidle");
    await page.clock.runFor(31_000);
    await expect(rollup(page)).toHaveText("1 unknown");
    await expect(instanceRow(page, "api")).toContainText("observed 2026-11-14T09:12Z");
    expect(reads).toBeGreaterThanOrEqual(2);
  });

  test("agent not reporting: every instance unknown", async ({ page }) => {
    app = await serveConsole(
      server(
        [
          { name: "api", health: "unknown" },
          { name: "web", health: "unknown" },
        ],
        "unknown",
      ),
    );
    await page.goto(app.url);
    await page.getByRole("link", { name: "Environments" }).click();
    await expect(rollup(page)).toHaveText("2 unknown");
    await expect(page.getByRole("cell", { name: "healthy", exact: true })).toHaveCount(0);
    await capture(page, "health-agent-silent");
    await expectDesignRules(page);
  });

  test("an older server without status keeps the inspect health", async ({ page }) => {
    app = await serveConsole(
      server([{ name: "api", health: "healthy" }], "ok", [], {
        status: 404,
        body: { error: "not found" },
      }),
    );
    await page.goto(app.url);
    await page.getByRole("link", { name: "Environments" }).click();
    await expect(instanceRow(page, "api").getByRole("cell", { name: "healthy" })).toBeVisible();
    await expect(rollup(page)).toHaveText("1 healthy");
    await expectDesignRules(page);
  });

  test("dense fleet", async ({ page }) => {
    const states = ["healthy", "unhealthy", "unknown", "healthy"];
    const instances = Array.from({ length: 40 }, (_, index): Instance => {
      const health = states[index % states.length] ?? "healthy";
      return {
        name: `svc-${String(index).padStart(2, "0")}`,
        health,
        ...(health === "unhealthy"
          ? { checks: [{ name: "http", state: "failing", message: "503 from /ready" }] }
          : {}),
      };
    });
    const others = Array.from({ length: 60 }, (_, index): [string, string] => [
      `zone-${String(index).padStart(2, "0")}`,
      ["ok", "unknown", "error"][index % 3] ?? "ok",
    ]);
    app = await serveConsole(server(instances, "error", others));
    await page.goto(app.url);
    const counts = await fleetCounts(page);
    await expect(counts.unhealthy).toHaveText("21");
    await expect(counts.unknown).toHaveText("20");
    await page.getByRole("link", { name: "Environments" }).click();
    await expect(rollup(page)).toHaveText("10 failing · 10 unknown · 20 healthy");
    await capture(page, "health-dense");
    await expectDesignRules(page);
  });
});

test.describe("environment instance health on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("failing checks stay inside the instance card", async ({ page }) => {
    app = await serveConsole(server(FAILING, "error"));
    await page.goto(app.url);
    await page.getByRole("link", { name: "Environments" }).click();
    await expect(instanceRow(page, "api")).toContainText("disk failing: 97% full on /var");
    await expect(rollup(page)).toHaveText("1 failing · 1 warning · 1 healthy");
    await instanceRow(page, "api").getByRole("cell").nth(5).scrollIntoViewIfNeeded();
    await capture(page, "health-phone");
    // The top navigation overflows a phone on every screen today; hold the health
    // card itself to the viewport and the copy rules.
    const card = page
      .locator("table")
      .filter({ has: page.getByRole("columnheader", { name: "Deployed" }) })
      .locator("xpath=..");
    const box = await card.boundingBox();
    expect((box?.x ?? 0) + (box?.width ?? Infinity)).toBeLessThanOrEqual(390);
    expect(await page.locator("body").textContent()).not.toMatch(
      /\bADR\b|#\d+|HTTP \d{3}|\/v1\/|\bat \w+ \(|Error:|—/,
    );
  });
});
