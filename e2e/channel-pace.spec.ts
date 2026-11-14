// Channel upgrade pace on Releases against a mocked API. Run with `pnpm build && pnpm e2e`.
import { type Page, expect, test } from "@playwright/test";
import type { ChannelPage, FleetStatusReport, PaceInstanceProgress } from "../src/api/tenkai.gen";
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
    {
      id: "channel:api/stable",
      product: "api",
      name: "stable",
      head: "api@1.4.0",
      exposure_grace_ms: 7 * 86_400_000,
    },
    { id: "channel:api/dev", product: "api", name: "dev", head: "" },
    { id: "channel:web/stable", product: "web", name: "stable", head: "web@2.0.0" },
  ],
};

/** The channel list from a server that reports configured paces. */
const listed = (pace: number | null): ChannelPage => ({
  items: CHANNELS.items.map((item) =>
    item.product === "web"
      ? { ...item, upgrade_pace_ms: 60_000 }
      : item.name === "stable" && pace !== null
        ? { ...item, upgrade_pace_ms: pace }
        : item,
  ),
});

const MANAGER = ["read", "publish", "management"];
const ok = (body: unknown): Reply => ({ status: 200, body });
const PACE = /^\/v1\/products\/([^/]+)\/channels\/([^/]+)\/pace$/;
const ADMIT = "/v1/products/api/channels/stable/admit";

type Options = {
  /** Pace on `api/stable` in ms; `null` for none. */
  pace?: number | null;
  /**
   * Configured pace on `api/stable` in the channel list; `null` for off.
   * Omitted for a server without the field. When set, writes change it and
   * leave the pace in effect alone, as a newer server does.
   */
  configured?: number | null;
  /** The pace each accepted write leaves, in order: what the server applied. */
  writes?: (number | null)[];
  capabilities?: string[];
  /** Replaces every pace GET, for an older server. */
  read?: Reply;
  /** Replaces the pace POST answer, for a refusal. */
  write?: Reply;
  /** Instances each pace GET reports, in order; the last one repeats. */
  reads?: PaceInstanceProgress[][];
  /** Instances reported after an accepted early admission. */
  admitted?: PaceInstanceProgress[];
  /** Replaces the admit answer, for a refusal. */
  admit?: Reply;
};

const paceRead = (ms: number | null, instances: PaceInstanceProgress[]): Reply =>
  ms === null
    ? { status: 404, body: { error: "channel api/stable has no upgrade pace on its current head" } }
    : ok({ release: "api@1.4.0", duration_ms: ms, promoted_at_ms: 1, instances });

/** A server whose `api/stable` pace follows the writes it accepts. */
const server = ({
  pace = null,
  configured,
  writes = [],
  capabilities = ["read"],
  read,
  write,
  reads = [[]],
  admitted,
  admit,
}: Options): Routes => {
  let current = pace;
  let config = configured;
  const pending = [...writes];
  let progress = [...reads];
  return (path, request) => {
    if (path === ADMIT && request.method === "POST") {
      if (admit) {
        return admit;
      }
      if (admitted) {
        progress = [admitted];
      }
      return ok({ version: 1, operation: "channel_admit", message: "instance admitted" });
    }
    if (PACE.test(path)) {
      if (request.method !== "POST") {
        const instances = progress.length > 1 ? (progress.shift() ?? []) : (progress[0] ?? []);
        return read ?? paceRead(current, instances);
      }
      if (write) {
        return write;
      }
      if (pending.length > 0) {
        const next = pending.shift() ?? null;
        if (config === undefined) {
          current = next;
        } else {
          config = next;
        }
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
      return ok(config === undefined ? CHANNELS : listed(config));
    }
    return undefined;
  };
};

const section = (page: Page) => page.getByRole("region", { name: "Upgrade pace" });
const value = (page: Page) => section(page).getByRole("definition");
const paceList = (page: Page) => section(page).getByRole("definition").locator("xpath=..");
const NOTE = "A changed pace applies from the next promotion.";

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

  test("shows the channel's declared exposure grace", async ({ page }) => {
    app = await serveConsole(server({}));
    await openPace(page, app);
    await expect(section(page).getByLabel("Channel grace")).toHaveText("exposure grace 7d");
    await section(page).getByRole("combobox", { name: "Channel" }).selectOption("web/stable");
    await expect(section(page).getByLabel("Channel grace")).toHaveText("exposure grace not set");
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

test.describe("configured upgrade pace", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("shows one pace when the configured pace is in effect", async ({ page }) => {
    app = await serveConsole(
      server({ pace: 7_200_000, configured: 7_200_000, capabilities: MANAGER }),
    );
    await openPace(page, app);
    await expect(paceList(page)).toHaveText("configured2h");
    await expect(section(page)).not.toContainText(NOTE);
    await page.screenshot({ path: test.info().outputPath("configured-same.png"), fullPage: true });
    await expectDesignRules(page);
  });

  test("shows the pace in effect when the configured pace differs", async ({ page }) => {
    app = await serveConsole(
      server({ pace: 7_200_000, configured: 3_600_000, capabilities: MANAGER }),
    );
    await openPace(page, app);
    await expect(paceList(page)).toHaveText(
      "configured1h applies from the next promotionin effect2h",
    );
    await expect(section(page)).not.toContainText(NOTE);
    await page.screenshot({
      path: test.info().outputPath("configured-differs.png"),
      fullPage: true,
    });
    await expectDesignRules(page);
  });

  test("shows pacing off", async ({ page }) => {
    app = await serveConsole(server({ configured: null, capabilities: MANAGER }));
    await openPace(page, app);
    await expect(paceList(page)).toHaveText("configuredoff");
    await expect(section(page).getByRole("button", { name: "Turn off" })).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath("configured-off.png"), fullPage: true });
    await expectDesignRules(page);
  });

  test("keeps the pace on the current head and the note on a server without the field", async ({
    page,
  }) => {
    app = await serveConsole(server({ pace: 7_200_000, capabilities: MANAGER }));
    await openPace(page, app);
    await expect(paceList(page)).toHaveText("current head2h");
    await expect(section(page)).toContainText(NOTE);
    await page.screenshot({
      path: test.info().outputPath("configured-absent.png"),
      fullPage: true,
    });
    await expectDesignRules(page);
  });

  test("updates the configured pace at once after each write", async ({ page }) => {
    app = await serveConsole(
      server({
        pace: 7_200_000,
        configured: 7_200_000,
        writes: [3_600_000, null],
        capabilities: MANAGER,
      }),
    );
    await openPace(page, app);
    await expect(paceList(page)).toHaveText("configured2h");
    const lists = app.sent.filter(({ path }) => path === "/v1/channels").length;
    await section(page).getByRole("textbox", { name: "Pace" }).fill("1h");
    await section(page).getByRole("button", { name: "Set pace" }).click();
    await section(page).getByRole("button", { name: "Set api/stable pace to 1h" }).click();
    await expect(section(page).getByRole("status")).toHaveText("Pace set to 1h and audited.");
    await expect(paceList(page)).toHaveText(
      "configured1h applies from the next promotionin effect2h",
    );
    expect(app.sent.filter(({ path }) => path === "/v1/channels").length).toBeGreaterThan(lists);

    // A configured pace not yet in effect can still be turned off.
    await section(page).getByRole("button", { name: "Turn off" }).click();
    await section(page).getByRole("button", { name: "Turn off api/stable pace" }).click();
    await expect(paceList(page)).toHaveText(
      "configuredoff applies from the next promotionin effect2h",
    );
    await page.screenshot({
      path: test.info().outputPath("configured-after-set.png"),
      fullPage: true,
    });
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
  test("keeps a differing configured pace inside the viewport", async ({ page }) => {
    app = await serveConsole(
      server({ pace: 7_200_000, configured: 3_600_000, capabilities: MANAGER }),
    );
    await openPace(page, app);
    await expect(section(page)).toContainText("applies from the next promotion");
    const box = await section(page).boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
    await page.screenshot({
      path: test.info().outputPath("configured-differs-phone.png"),
      fullPage: true,
    });
  });

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

// Server times: Wed 15 Nov 2023 02:00 and 04:00 UTC.
const T1 = 1_700_013_600_000;
const T2 = T1 + 7_200_000;
const STARTED: PaceInstanceProgress = { environment: "canary", instance: "api", state: "started" };
const WAITING: PaceInstanceProgress = {
  environment: "stage",
  instance: "api",
  state: "waiting",
  eligible_at_ms: T1,
};
const PAUSED: PaceInstanceProgress = {
  environment: "prod",
  instance: "api",
  state: "paused",
  eligible_at_ms: T2,
  next_opens_at_ms: T1,
};
const EARLY = { action: "admit", actor: "alice", reason: "canary host", at: T1 };
const ADMITTED: PaceInstanceProgress = {
  environment: "stage",
  instance: "api",
  state: "admitted",
  early_admission: EARLY,
};

const progressLine = (page: Page) => section(page).getByText(/^api@1\.4\.0: /);
const rows = (page: Page) =>
  section(page).getByRole("table", { name: "Instances" }).locator("tbody tr");

const openProgress = async (page: Page, app: MockBackend) => {
  await openPace(page, app);
  await expect(value(page)).toHaveText("2h");
};

const admitTo = async (page: Page, instance: string, reason: string) => {
  await section(page).getByRole("combobox", { name: "Instance" }).selectOption(instance);
  await section(page).getByRole("textbox", { name: "Reason" }).fill(reason);
  await section(page).getByRole("button", { name: "Admit early" }).click();
  await section(page)
    .getByRole("button", { name: `Admit ${instance} early: ${reason}` })
    .click();
};

test.describe("channel upgrade pacing progress", () => {
  test.use({ viewport: { width: 1280, height: 800 }, timezoneId: "UTC" });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("in progress shows server eligible times, windows, and early admissions", async ({
    page,
  }) => {
    app = await serveConsole(
      server({
        pace: 7_200_000,
        reads: [
          [
            STARTED,
            WAITING,
            PAUSED,
            { ...ADMITTED, environment: "edge", state: "paused", next_opens_at_ms: T2 },
          ],
        ],
      }),
    );
    await openProgress(page, app);
    await expect(progressLine(page)).toHaveText("api@1.4.0: in progress, 1 of 4 started");
    await expect(rows(page)).toHaveText([
      /^canary\/apistarted$/,
      /^stage\/apiwaitingWed 15 Nov 02:00$/,
      /^prod\/apipausedWed 15 Nov 04:00window opens Wed 15 Nov 02:00$/,
      /^edge\/apipausedunknownwindow opens Wed 15 Nov 04:00; admitted early by alice: canary host$/,
    ]);
    await expect(section(page)).toContainText("Rollbacks and recall removals are never paced.");
    await page.screenshot({
      path: test.info().outputPath("progress-in-progress.png"),
      fullPage: true,
    });
    await expectDesignRules(page);
  });

  test("paused by window when every pending instance waits on a closed window", async ({
    page,
  }) => {
    app = await serveConsole(server({ pace: 7_200_000, reads: [[STARTED, PAUSED]] }));
    await openProgress(page, app);
    await expect(progressLine(page)).toHaveText(
      "api@1.4.0: paused by maintenance window, 1 of 2 started",
    );
    await page.screenshot({ path: test.info().outputPath("progress-paused.png"), fullPage: true });
    await expectDesignRules(page);
  });

  test("complete offers nothing to admit", async ({ page }) => {
    app = await serveConsole(
      server({ pace: 7_200_000, capabilities: MANAGER, reads: [[STARTED, STARTED]] }),
    );
    await openProgress(page, app);
    await expect(progressLine(page)).toHaveText("api@1.4.0: complete, 2 of 2 started");
    await page.waitForLoadState("networkidle");
    await expect(section(page).getByRole("button", { name: "Admit early" })).toHaveCount(0);
    await page.screenshot({
      path: test.info().outputPath("progress-complete.png"),
      fullPage: true,
    });
    await expectDesignRules(page);
  });

  test("shows progress without admission when not permitted", async ({ page }) => {
    app = await serveConsole(server({ pace: 7_200_000, reads: [[WAITING, PAUSED]] }));
    await openProgress(page, app);
    await expect(rows(page)).toHaveCount(2);
    await page.waitForLoadState("networkidle");
    await expect(section(page).getByRole("button")).toHaveCount(0);
    await expect(section(page).getByRole("textbox")).toHaveCount(0);
    await page.screenshot({
      path: test.info().outputPath("progress-no-permission.png"),
      fullPage: true,
    });
    await expectDesignRules(page);
  });

  test("admits one instance with a reason, then reads progress again", async ({ page }) => {
    app = await serveConsole(
      server({
        pace: 7_200_000,
        capabilities: MANAGER,
        reads: [[STARTED, WAITING, PAUSED]],
        admitted: [STARTED, ADMITTED, PAUSED],
      }),
    );
    const bodies: unknown[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST") {
        bodies.push(request.postDataJSON());
      }
    });
    await openProgress(page, app);
    await expect(
      section(page).getByRole("combobox", { name: "Instance" }).locator("option"),
    ).toHaveText(["Instance", "stage/api", "prod/api"]);
    await section(page).getByRole("combobox", { name: "Instance" }).selectOption("stage/api");
    await expect(section(page).getByRole("button", { name: "Admit early" })).toBeDisabled();
    await admitTo(page, "stage/api", "canary host");
    await expect(section(page).getByRole("status")).toHaveText(
      "stage/api admitted early and audited.",
    );
    await expect(rows(page).nth(1)).toHaveText(/admitted early by alice: canary host$/);
    expect(posts(app)).toEqual([ADMIT]);
    expect(bodies).toEqual([
      {
        version: 1,
        operation: "channel_admit",
        environment: "stage",
        instance: "api",
        reason: "canary host",
      },
    ]);
    await page.screenshot({
      path: test.info().outputPath("progress-admitted.png"),
      fullPage: true,
    });
    await expectDesignRules(page);
  });

  test("an admit refusal shows fixed copy", async ({ page }) => {
    app = await serveConsole(
      server({
        pace: 7_200_000,
        capabilities: MANAGER,
        reads: [[WAITING]],
        admit: { status: 409, body: { error: "internal detail at store.rs:42" } },
      }),
    );
    await openProgress(page, app);
    await admitTo(page, "stage/api", "canary host");
    await expect(section(page).getByRole("alert")).toHaveText("Admission refused.");
    await expectDesignRules(page);
  });

  test("a lost admit response reads as unknown and is sent once", async ({ page }) => {
    app = await serveConsole(
      server({ pace: 7_200_000, capabilities: MANAGER, reads: [[WAITING]] }),
    );
    let attempts = 0;
    await page.route("**/admit", async (route) => {
      attempts += 1;
      return route.abort("connectionreset");
    });
    await openProgress(page, app);
    await admitTo(page, "stage/api", "canary host");
    await expect(section(page).getByRole("status")).toHaveText(/outcome is unknown/);
    await page.waitForLoadState("networkidle");
    expect(attempts).toBe(1);
    expect(posts(app)).toEqual([]);
    await expect(rows(page)).toHaveText([/^stage\/apiwaiting/]);
    await page.screenshot({ path: test.info().outputPath("progress-lost.png"), fullPage: true });
    await expectDesignRules(page);
  });

  test("reads progress again after a minute, not every second", async ({ page }) => {
    await page.clock.install({ time: T1 - 3_600_000 });
    app = await serveConsole(
      server({
        pace: 7_200_000,
        reads: [
          [STARTED, WAITING],
          [STARTED, STARTED],
        ],
      }),
    );
    await openProgress(page, app);
    await expect(progressLine(page)).toHaveText("api@1.4.0: in progress, 1 of 2 started");
    await page.waitForLoadState("networkidle");
    const reads = () => app.sent.filter((sent) => PACE.test(sent.path)).length;
    expect(reads()).toBe(1);
    await page.clock.runFor(30_000);
    await page.waitForLoadState("networkidle");
    expect(reads()).toBe(1);
    await page.clock.runFor(30_000);
    await expect(progressLine(page)).toHaveText("api@1.4.0: complete, 2 of 2 started");
    expect(reads()).toBe(2);
    await page.clock.runFor(120_000);
    await page.waitForLoadState("networkidle");
    expect(reads()).toBe(2);
  });
});

test.describe("channel upgrade pacing progress on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, timezoneId: "UTC" });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("keeps progress and admission inside the viewport", async ({ page }) => {
    app = await serveConsole(
      server({
        pace: 7_200_000,
        capabilities: MANAGER,
        reads: [[STARTED, WAITING, { ...PAUSED, early_admission: EARLY }]],
      }),
    );
    await openProgress(page, app);
    await expect(rows(page)).toHaveCount(3);
    const box = await section(page).boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
    await page.screenshot({ path: test.info().outputPath("progress-phone.png"), fullPage: true });
  });
});
