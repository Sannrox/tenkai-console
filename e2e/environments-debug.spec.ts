// Time-boxed debug sessions on an instance, against a mocked API. Run with `pnpm build && pnpm e2e`.
import { type Page, expect, test } from "@playwright/test";
import type { DebugSession, FleetEnvironmentRow, FleetStatusReport } from "../src/api/tenkai.gen";
import {
  type MockBackend,
  type Reply,
  type Routes,
  expectDesignRules,
  openEnvironment,
  serveConsole,
} from "./mock-backend";

const HOST_ME = {
  principal: "host:uid:1000",
  kind: "human",
  capabilities: ["read", "debug"],
  user: "alice",
  groups: ["tenkai-operator"],
  source: "host",
};

const ok = (body: unknown): Reply => ({ status: 200, body });

const FLEET_ROW: FleetEnvironmentRow = {
  id: "env:prod",
  name: "prod",
  description: "fixture",
  subscription_count: 2,
  products_current: 1,
  products_behind: 1,
  products_missing: 0,
  unhealthy: false,
  health_summary: "ok",
  lease_held: false,
  posture: "behind",
};

const FLEET: FleetStatusReport = {
  environments: [FLEET_ROW],
  environment_count: 1,
  environments_current: 0,
  environments_behind: 1,
  environments_unhealthy: 0,
  environments_empty: 0,
};

const SUBSCRIPTIONS = [
  {
    product: "api",
    instance: "api",
    channel: "stable",
    head: "1.1.0",
    deployed: "1.0.0",
    state: "behind",
    health: "unhealthy",
  },
  {
    product: "web",
    instance: "web",
    channel: "stable",
    head: "1.1.0",
    deployed: "1.1.0",
    state: "current",
    health: "healthy",
  },
];

const OPENED_AT = Date.now() - 12 * 60_000;
const OPEN_UNTIL = Date.now() + 3 * 3_600_000 + 12 * 60_000;
const WRITE_UNTIL = Date.now() + 22 * 60_000;

const OPEN: DebugSession = {
  id: "dbg_1",
  environment: "prod",
  instance: "api",
  subject: "alice",
  opened_by: "alice",
  mode: "read",
  reason: "5xx after 1.18.2, need logs",
  opened_at: OPENED_AT,
  not_after: OPEN_UNTIL,
  state: "open",
  runtime: { instance: "runner-3", attached_at: OPENED_AT + 60_000 },
};

const EXPIRED: DebugSession = {
  id: "dbg_0",
  environment: "prod",
  instance: "api",
  subject: "alice",
  opened_by: "alice",
  mode: "read",
  reason: "5xx after 1.18.2, need logs",
  opened_at: OPENED_AT - 4 * 3_600_000,
  not_after: OPENED_AT,
  state: "expired",
  closed_at: OPENED_AT,
};

const PENDING = {
  id: "el_1",
  session: "dbg_1",
  environment: "prod",
  requested_by: "alice",
  requester: "alice",
  reason: "restart to clear 502s",
  requested_at: OPENED_AT + 8 * 60_000,
  duration_ms: 30 * 60_000,
  state: "pending" as const,
  approvals: [{ identity: "alice", key_id: "k0", approved_at: OPENED_AT + 8 * 60_000 }],
};

const ACTIVE = {
  ...PENDING,
  state: "active" as const,
  active_from: OPENED_AT + 10 * 60_000,
  not_after: WRITE_UNTIL,
};

type Fixture = {
  me?: typeof HOST_ME;
  policy?: Reply;
  sessions?: Reply;
  elevations?: Reply;
};

const server =
  (fixture: Fixture = {}): Routes =>
  (path, request) => {
    if (path === "/v1/auth/oidc") {
      return { status: 404, body: { error: "no oidc client" } };
    }
    if (path === "/v1/auth/me") {
      return ok(fixture.me ?? HOST_ME);
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
      return ok({
        id: "env:prod",
        name: "prod",
        description: "fixture",
        execution_note: "",
        facts: {},
        lease: { held: false, status: "free" },
        latest_plan: null,
        subscriptions: SUBSCRIPTIONS,
      });
    }
    if (path === "/v1/environments/prod/status") {
      return ok(SUBSCRIPTIONS);
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
      return fixture.policy ?? ok({ configured: true, mode: "human", debug_sessions: "elevate" });
    }
    if (path === "/v1/debug-sessions") {
      if ((request.method ?? "GET") === "POST") {
        return { status: 201, body: OPEN };
      }
      return fixture.sessions ?? ok({ sessions: [] });
    }
    if (path === "/v1/debug-sessions/dbg_1/elevations") {
      return fixture.elevations ?? ok({ elevations: [] });
    }
    return undefined;
  };

const section = (page: Page) => page.getByRole("region", { name: "Debug api" });

const openDebug = async (page: Page, app: MockBackend) => {
  await page.goto(app.url);
  await openEnvironment(page);
  await page.getByRole("button", { name: "Debug api" }).click();
  await expect(section(page)).toBeVisible();
};

const capture = (page: Page, name: string) =>
  page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });

test.describe("debug sessions on an instance", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("the control is absent without the grant, and nothing is read until asked", async ({
    page,
  }) => {
    app = await serveConsole(server({ me: { ...HOST_ME, capabilities: ["read", "management"] } }));
    await page.goto(app.url);
    await openEnvironment(page);
    await expect(page.getByRole("button", { name: "Debug api" })).toHaveCount(0);
    expect(app.sent.some((sent) => sent.path.startsWith("/v1/debug-sessions"))).toBe(false);
  });

  test("an agent session never sees the control", async ({ page }) => {
    app = await serveConsole(server({ me: { ...HOST_ME, kind: "agent", principal: "agent:bot" } }));
    await page.goto(app.url);
    await openEnvironment(page);
    await expect(page.getByRole("button", { name: "Debug api" })).toHaveCount(0);
  });

  test("empty: reason and open, current and behind rows both offer it", async ({ page }) => {
    app = await serveConsole(server());
    await page.goto(app.url);
    await openEnvironment(page);
    await expect(page.getByRole("button", { name: "Debug api" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Debug web" })).toBeVisible();
    expect(app.sent.some((sent) => sent.path.startsWith("/v1/debug-sessions"))).toBe(false);
    await page.getByRole("button", { name: "Debug api" }).click();
    await expect(section(page)).toContainText("No session");
    await expect(section(page).getByRole("button", { name: "Open session" })).toBeVisible();
    await capture(page, "debug-empty");
    await expectDesignRules(page);
  });

  test("forbidden by environment", async ({ page }) => {
    app = await serveConsole(
      server({ policy: ok({ configured: true, mode: "human", debug_sessions: "forbid" }) }),
    );
    await openDebug(page, app);
    await expect(section(page)).toContainText("This environment forbids debug sessions.");
    await expect(section(page).getByRole("button", { name: "Open session" })).toHaveCount(0);
    await capture(page, "debug-forbidden");
    await expectDesignRules(page);
  });

  test("an older server without the route reads unavailable", async ({ page }) => {
    app = await serveConsole(server({ sessions: { status: 404, body: { error: "not found" } } }));
    await openDebug(page, app);
    await expect(section(page)).toContainText("This server does not offer debug sessions.");
    await capture(page, "debug-unavailable");
    await expectDesignRules(page);
  });

  test("open session sends one POST and is not retried", async ({ page }) => {
    app = await serveConsole(server());
    await openDebug(page, app);
    await section(page).getByLabel("Debug reason").fill("5xx after 1.18.2, need logs");
    await section(page).getByRole("button", { name: "Open session" }).click();
    await section(page).getByRole("button", { name: "Open read-only debug on api" }).click();
    await expect
      .poll(() =>
        app.sent.filter((sent) => sent.method === "POST" && sent.path === "/v1/debug-sessions"),
      )
      .toHaveLength(1);
    await expectDesignRules(page);
  });

  test("read-only live session shows the bound and close", async ({ page }) => {
    app = await serveConsole(server({ sessions: ok({ sessions: [OPEN, EXPIRED] }) }));
    await openDebug(page, app);
    await expect(section(page)).toContainText("read");
    await expect(section(page)).toContainText("alice for 5xx after 1.18.2, need logs");
    await expect(section(page).getByRole("button", { name: "Request write" })).toBeVisible();
    await expect(section(page).getByRole("button", { name: "Close", exact: true })).toBeVisible();
    await expect(section(page).getByRole("table", { name: "Debug history" })).toContainText(
      "expired",
    );
    await capture(page, "debug-read");
    await expectDesignRules(page);
  });

  test("expired session does not reconnect; open starts another", async ({ page }) => {
    app = await serveConsole(server({ sessions: ok({ sessions: [EXPIRED] }) }));
    await openDebug(page, app);
    await expect(section(page)).toContainText("Session ended at the bound");
    await expect(section(page).getByRole("button", { name: "Open session" })).toBeVisible();
    await expect(section(page).getByRole("button", { name: "Request write" })).toHaveCount(0);
    await capture(page, "debug-expired");
    await expectDesignRules(page);
  });

  test("read policy has no write request", async ({ page }) => {
    app = await serveConsole(
      server({
        policy: ok({ configured: true, mode: "human", debug_sessions: "read" }),
        sessions: ok({ sessions: [OPEN] }),
      }),
    );
    await openDebug(page, app);
    await expect(section(page)).toContainText("read");
    await expect(section(page).getByRole("button", { name: "Request write" })).toHaveCount(0);
    await expectDesignRules(page);
  });

  test("elevation pending asks for a signed envelope", async ({ page }) => {
    app = await serveConsole(
      server({
        sessions: ok({ sessions: [OPEN] }),
        elevations: ok({ elevations: [PENDING] }),
      }),
    );
    await openDebug(page, app);
    await expect(section(page)).toContainText("write pending");
    await expect(section(page)).toContainText("0 of 1 other approver");
    await expect(section(page).getByRole("button", { name: "Request write" })).toHaveCount(0);
    await expect(section(page).getByLabel("Elevation envelope")).toBeVisible();
    await capture(page, "debug-pending");
    await expectDesignRules(page);
  });

  test("active write offers revoke", async ({ page }) => {
    app = await serveConsole(
      server({
        sessions: ok({ sessions: [OPEN] }),
        elevations: ok({ elevations: [ACTIVE] }),
      }),
    );
    await openDebug(page, app);
    await expect(section(page)).toContainText("write until");
    await expect(section(page).getByRole("button", { name: "Revoke write" })).toBeVisible();
    await expect(section(page).getByRole("button", { name: "Request write" })).toHaveCount(0);
    await capture(page, "debug-write");
    await expectDesignRules(page);
  });

  test("runtime unreachable is named without internals", async ({ page }) => {
    app = await serveConsole(
      server({
        sessions: ok({
          sessions: [
            {
              ...OPEN,
              runtime: {
                instance: "runner-3",
                attached_at: OPEN.opened_at,
                stream_error: "upgrade refused",
              },
            },
          ],
        }),
      }),
    );
    await openDebug(page, app);
    await expect(section(page)).toContainText("no stream: proxy refused the upgrade");
    await expectDesignRules(page);
  });

  test("close hides the panel", async ({ page }) => {
    app = await serveConsole(server());
    await openDebug(page, app);
    await section(page).getByRole("button", { name: "Close panel" }).click();
    await expect(section(page)).toHaveCount(0);
  });
});

test.describe("debug sessions on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("the panel stays inside the viewport", async ({ page }) => {
    app = await serveConsole(server({ sessions: ok({ sessions: [OPEN, EXPIRED] }) }));
    await openDebug(page, app);
    await section(page).scrollIntoViewIfNeeded();
    await capture(page, "debug-phone");
    const box = await section(page).boundingBox();
    expect((box?.x ?? 0) + (box?.width ?? Infinity)).toBeLessThanOrEqual(390);
    expect(await page.locator("body").textContent()).not.toMatch(
      /\bADR\b|#\d+|HTTP \d{3}|\/v1\/|\bat \w+ \(|Error:|—/,
    );
  });
});
