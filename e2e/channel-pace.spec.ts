// Channel upgrade pace on Releases against a mocked API. Run with `pnpm build && pnpm e2e`.
import { type Page, expect, test } from "@playwright/test";
import type { ChannelPage, FleetStatusReport } from "../src/api/tenkai.gen";
import {
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

const CHANNELS: ChannelPage = {
  items: [
    { id: "channel:api/stable", product: "api", name: "stable", head: "api@1.4.0" },
    { id: "channel:api/dev", product: "api", name: "dev", head: "" },
    { id: "channel:web/stable", product: "web", name: "stable", head: "web@2.0.0" },
  ],
};

const MANAGER = ["read", "publish", "management"];
const ok = (body: unknown): Reply => ({ status: 200, body });
const PACE = /^\/v1\/products\/([^/]+)\/channels\/([^/]+)\/pace$/;

type Options = {
  /** Pace on `api/stable` in ms; `null` for none. */
  pace?: number | null;
  /** The pace each accepted write leaves, in order: what the server applied. */
  writes?: (number | null)[];
  capabilities?: string[];
  /** Replaces every pace GET, for an older server. */
  read?: Reply;
  /** Replaces the pace POST answer, for a refusal. */
  write?: Reply;
};

const paceRead = (ms: number | null): Reply =>
  ms === null
    ? { status: 404, body: { error: "channel api/stable has no upgrade pace on its current head" } }
    : ok({ release: "api@1.4.0", duration_ms: ms, promoted_at_ms: 1, instances: [] });

/** A server whose `api/stable` pace follows the writes it accepts. */
const server = ({
  pace = null,
  writes = [],
  capabilities = ["read"],
  read,
  write,
}: Options): Routes => {
  let current = pace;
  const pending = [...writes];
  return (path, request) => {
    if (PACE.test(path)) {
      if (request.method !== "POST") {
        return read ?? paceRead(current);
      }
      if (write) {
        return write;
      }
      if (pending.length > 0) {
        current = pending.shift() ?? null;
      }
      return ok({ version: 1, operation: "channel_configure", message: "upgrade pace set" });
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
        groups: [],
        source: "host",
      });
    }
    if (path === "/v1/fleet/status") {
      return ok(FLEET);
    }
    if (path === "/v1/environments") {
      return ok([]);
    }
    if (path === "/v1/events") {
      return ok({ events: [], next_cursor: "0" });
    }
    if (path === "/v1/channels") {
      return ok(CHANNELS);
    }
    return undefined;
  };
};

const section = (page: Page) => page.getByRole("region", { name: "Upgrade pace" });
const value = (page: Page) => section(page).getByRole("definition");

const openPace = async (page: Page, app: MockBackend, channel = "api/stable") => {
  await page.goto(app.url);
  await page.getByRole("link", { name: "Releases" }).click();
  await section(page).getByRole("combobox", { name: "Channel" }).selectOption(channel);
};

const posts = (app: MockBackend) =>
  app.sent.filter((sent) => sent.method === "POST").map((sent) => sent.path);

test.describe("channel upgrade pace", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("offers only channels with a head and reads no pace as off", async ({ page }) => {
    app = await serveConsole(server({}));
    await openPace(page, app);
    await expect(section(page).getByRole("option")).toHaveText([
      "Channel",
      "api/stable",
      "web/stable",
    ]);
    await expect(value(page)).toHaveText("off");
    await page.screenshot({ path: test.info().outputPath("pace-none.png"), fullPage: true });
    await expectDesignRules(page);
  });

  test("shows a set pace", async ({ page }) => {
    app = await serveConsole(server({ pace: 7_200_000 }));
    await openPace(page, app);
    await expect(value(page)).toHaveText("2h");
    await page.screenshot({ path: test.info().outputPath("pace-set.png"), fullPage: true });
    await expectDesignRules(page);
  });

  test("offers no editor without the permission", async ({ page }) => {
    app = await serveConsole(server({ pace: 7_200_000 }));
    await openPace(page, app);
    await expect(value(page)).toHaveText("2h");
    await page.waitForLoadState("networkidle");
    await expect(section(page).getByRole("button")).toHaveCount(0);
    await expect(section(page).getByRole("textbox")).toHaveCount(0);
    await page.screenshot({
      path: test.info().outputPath("pace-no-permission.png"),
      fullPage: true,
    });
    await expectDesignRules(page);
  });

  test("says an older server does not report pace", async ({ page }) => {
    app = await serveConsole(
      server({
        capabilities: MANAGER,
        read: { status: 405, body: { error: "method not allowed" } },
      }),
    );
    await openPace(page, app);
    await expect(section(page)).toContainText("This server does not report upgrade pace.");
    await expect(section(page).getByRole("button")).toHaveCount(0);
    await page.screenshot({
      path: test.info().outputPath("pace-older-server.png"),
      fullPage: true,
    });
    await expectDesignRules(page);
  });

  test("sets a pace, then turns it off, reading it back after each", async ({ page }) => {
    app = await serveConsole(server({ capabilities: MANAGER, writes: [7_200_000, null] }));
    const bodies: unknown[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST") {
        bodies.push(request.postDataJSON());
      }
    });
    await openPace(page, app);
    await expect(value(page)).toHaveText("off");
    await expect(section(page).getByRole("button", { name: "Turn off" })).toHaveCount(0);
    await section(page).getByRole("textbox", { name: "Pace" }).fill("2h");
    await section(page).getByRole("button", { name: "Set pace" }).click();
    await section(page).getByRole("button", { name: "Set api/stable pace to 2h" }).click();
    await expect(section(page).getByRole("status")).toHaveText("Pace set to 2h and audited.");
    await expect(value(page)).toHaveText("2h");
    await page.screenshot({ path: test.info().outputPath("pace-after-set.png"), fullPage: true });

    await section(page).getByRole("button", { name: "Turn off" }).click();
    await section(page).getByRole("button", { name: "Turn off api/stable pace" }).click();
    await expect(section(page).getByRole("status")).toHaveText("Pace turned off and audited.");
    await expect(value(page)).toHaveText("off");
    expect(posts(app)).toEqual([
      "/v1/products/api/channels/stable/pace",
      "/v1/products/api/channels/stable/pace",
    ]);
    expect(bodies).toEqual([
      { version: 1, operation: "channel_configure", upgrade_pace: "2h" },
      { version: 1, operation: "channel_configure", upgrade_pace: "off" },
    ]);
    await expectDesignRules(page);
  });

  test("a refusal shows fixed copy", async ({ page }) => {
    app = await serveConsole(
      server({
        capabilities: MANAGER,
        write: { status: 409, body: { error: "internal detail at store.rs:42" } },
      }),
    );
    await openPace(page, app);
    await section(page).getByRole("textbox", { name: "Pace" }).fill("2h");
    await section(page).getByRole("button", { name: "Set pace" }).click();
    await section(page).getByRole("button", { name: "Set api/stable pace to 2h" }).click();
    await expect(section(page).getByRole("alert")).toHaveText("Pace change refused.");
    await expectDesignRules(page);
  });

  test("a lost response reads as unknown and is sent once", async ({ page }) => {
    app = await serveConsole(server({ capabilities: MANAGER }));
    let attempts = 0;
    await page.route("**/pace", async (route) => {
      if (route.request().method() !== "POST") {
        return route.fallback();
      }
      attempts += 1;
      return route.abort("connectionreset");
    });
    await openPace(page, app);
    await section(page).getByRole("textbox", { name: "Pace" }).fill("2h");
    await section(page).getByRole("button", { name: "Set pace" }).click();
    await section(page).getByRole("button", { name: "Set api/stable pace to 2h" }).click();
    await expect(section(page).getByRole("status")).toHaveText(/outcome is unknown/);
    await page.waitForLoadState("networkidle");
    expect(attempts).toBe(1);
    expect(posts(app)).toEqual([]);
    await expect(value(page)).toHaveText("off");
    await page.screenshot({ path: test.info().outputPath("pace-lost.png"), fullPage: true });
    await expectDesignRules(page);
  });
});

test.describe("channel upgrade pace on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  // The top bar already overflows a phone, so overflow is checked on this section only.
  test("keeps the editor inside the viewport", async ({ page }) => {
    app = await serveConsole(server({ pace: 7_200_000, capabilities: MANAGER }));
    await openPace(page, app);
    await expect(value(page)).toHaveText("2h");
    await section(page).getByRole("button", { name: "Turn off" }).click();
    const box = await section(page).boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
    await page.screenshot({ path: test.info().outputPath("pace-phone.png"), fullPage: true });
    expect(await page.locator("body").textContent()).not.toMatch(
      /\bADR\b|#\d+|HTTP \d{3}|\/v1\/|\bat \w+ \(|Error:|—/,
    );
  });
});
