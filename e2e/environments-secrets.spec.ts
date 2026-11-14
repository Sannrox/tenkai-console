// Sealed secret age and rotation state, against a mocked API. Run with `pnpm build && pnpm e2e`.
import { type Page, expect, test } from "@playwright/test";
import type {
  FleetEnvironmentRow,
  FleetStatusReport,
  SealedSecretEntry,
  SealedSecretList,
} from "../src/api/tenkai.gen";
import {
  type MockBackend,
  type Reply,
  type Routes,
  expectDesignRules,
  serveConsole,
} from "./mock-backend";

const HOST_ME = {
  principal: "host:uid:1000",
  kind: "human",
  capabilities: ["read"],
  user: "alice",
  groups: ["tenkai-viewer"],
  source: "host",
};

const ok = (body: unknown): Reply => ({ status: 200, body });

const FLEET_ROW: FleetEnvironmentRow = {
  id: "env:prod",
  name: "prod",
  description: "fixture",
  subscription_count: 2,
  products_current: 2,
  products_behind: 0,
  products_missing: 0,
  unhealthy: false,
  health_summary: "ok",
  lease_held: false,
  posture: "current",
};

const FLEET: FleetStatusReport = {
  environments: [FLEET_ROW],
  environment_count: 1,
  environments_current: 1,
  environments_behind: 0,
  environments_unhealthy: 0,
  environments_empty: 0,
};

const SUBSCRIPTIONS = ["api", "web"].map((name) => ({
  product: name,
  instance: name,
  channel: "stable",
  head: "1.1.0",
  deployed: "1.1.0",
  state: "current",
  health: "healthy",
}));

// What the server adds to an instance that uses an overdue secret.
const ROTATE_CHECK = {
  name: "rotate-api-token",
  state: "warning",
  message: "api is overdue for rotation; set a new value with tenkaictl secret set",
};

const OVERDUE_STATUS = [SUBSCRIPTIONS[0], { ...SUBSCRIPTIONS[1], health_checks: [ROTATE_CHECK] }];

const CIPHERTEXT = "c2VhbGVkLWNpcGhlcnRleHQtZml4dHVyZQ==";
const WRAPPED_KEY = "d3JhcHBlZC1kYXRhLWtleS1maXh0dXJl";
const DIGEST = "sha256:5e3a1d0c9f";

const DAY = 86_400_000;
const entry = (fields: Partial<SealedSecretEntry>): SealedSecretEntry => ({
  secret: "db",
  key: "password",
  instance: "api",
  set_at: 1_700_000_000_000,
  set_by: "alice",
  digest: DIGEST,
  recipients: ["sha256:recipient"],
  sealed: {
    ciphertext: CIPHERTEXT,
    format_version: 1,
    wraps: [
      { encapsulated_key: WRAPPED_KEY, fingerprint: "sha256:recipient", wrapped_key: WRAPPED_KEY },
    ],
  },
  ...fields,
});

const WITHIN = entry({ age_ms: 10 * DAY, rotate_after: "90d" });
const OVERDUE = entry({
  secret: "api",
  key: "token",
  instance: "web",
  age_ms: 120 * DAY,
  rotate_after: "90d",
  overdue: true,
});
const NO_ROTATION = entry({ secret: "smtp", key: "pass", age_ms: 400 * DAY });

const list = (secrets: SealedSecretEntry[]): Reply =>
  ok({ environment: "prod", secrets } satisfies SealedSecretList);

/** `secrets` answers `GET .../sealed-secrets`; an overdue fixture adds the rotate check on `web`. */
const server =
  (secrets: Reply): Routes =>
  (path) => {
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
      const overdue = JSON.stringify(secrets.body).includes('"overdue":true');
      return ok(overdue ? OVERDUE_STATUS : SUBSCRIPTIONS);
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
    if (path === "/v1/environments/prod/sealed-secrets") {
      return secrets;
    }
    return undefined;
  };

const section = (page: Page) => page.getByRole("region", { name: "Sealed secrets" });
const rows = (page: Page) =>
  section(page)
    .getByRole("row")
    .filter({ has: page.locator("td") });

const open = async (page: Page, app: MockBackend) => {
  await page.goto(app.url);
  await page.getByRole("link", { name: "Environments" }).click();
  await expect(section(page)).toBeVisible();
  await expect(section(page)).not.toContainText("Loading");
};

const capture = (page: Page, name: string) =>
  page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });

const expectNoSecretMaterial = async (page: Page) => {
  const text = (await page.locator("body").textContent()) ?? "";
  const html = await page.content();
  for (const material of [CIPHERTEXT, WRAPPED_KEY, DIGEST]) {
    expect(text).not.toContain(material);
    expect(html).not.toContain(material);
  }
};

test.describe("sealed secret age and rotation", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("no secrets", async ({ page }) => {
    app = await serveConsole(server(list([])));
    await open(page, app);
    await expect(section(page).getByRole("table")).toHaveCount(0);
    await expect(section(page)).toContainText("none");
    await expect(section(page)).not.toContainText("overdue");
    await capture(page, "secrets-empty");
    await expectDesignRules(page);
  });

  test("no rotation set", async ({ page }) => {
    app = await serveConsole(server(list([NO_ROTATION])));
    await open(page, app);
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText("smtp/pass");
    await expect(rows(page).first()).toContainText("400d");
    await expect(rows(page).first()).toContainText("no rotation");
    await expect(section(page)).not.toContainText("overdue");
    await expectNoSecretMaterial(page);
    await expectDesignRules(page);
  });

  test("within age", async ({ page }) => {
    app = await serveConsole(server(list([WITHIN])));
    await open(page, app);
    await expect(rows(page).first()).toContainText("db/password");
    await expect(rows(page).first()).toContainText("10d");
    await expect(rows(page).first()).toContainText("90d");
    await expect(rows(page).first()).toContainText("within age");
    await expectNoSecretMaterial(page);
    await expectDesignRules(page);
  });

  test("overdue shows on the environment view with its instance and health check", async ({
    page,
  }) => {
    app = await serveConsole(server(list([WITHIN, NO_ROTATION, OVERDUE])));
    await open(page, app);
    await expect(section(page)).toContainText("1 overdue");
    await expect(rows(page).first()).toContainText("api/token");
    await expect(rows(page).first()).toContainText("web");
    await expect(rows(page).first()).toContainText("120d");
    await expect(rows(page).first()).toContainText("overdue");
    const web = page
      .getByRole("row")
      .filter({ has: page.getByRole("cell", { name: "web", exact: true }) });
    await expect(web.first()).toContainText("rotate-api-token warning");
    await capture(page, "secrets-overdue");
    await expectNoSecretMaterial(page);
    await expectDesignRules(page);
    expect(app.sent.every((sent) => sent.method === "GET")).toBe(true);
  });

  test("no permission", async ({ page }) => {
    app = await serveConsole(server({ status: 403, body: { error: "forbidden" } }));
    await open(page, app);
    await expect(section(page)).toContainText("No access");
    await capture(page, "secrets-forbidden");
    await expectDesignRules(page);
  });

  test("an older server without the route reads unavailable", async ({ page }) => {
    app = await serveConsole(server({ status: 404, body: { error: "not found" } }));
    await open(page, app);
    await expect(section(page)).toContainText("This server does not report sealed secrets.");
    await expectDesignRules(page);
  });
});

test.describe("sealed secrets on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("the section stays inside the viewport", async ({ page }) => {
    app = await serveConsole(server(list([WITHIN, NO_ROTATION, OVERDUE])));
    await open(page, app);
    await section(page).scrollIntoViewIfNeeded();
    await capture(page, "secrets-phone");
    // The top navigation overflows a phone on every screen today; hold this
    // section to the viewport and the copy rules.
    const box = await section(page).boundingBox();
    expect((box?.x ?? 0) + (box?.width ?? Infinity)).toBeLessThanOrEqual(390);
    expect(await page.locator("body").textContent()).not.toMatch(
      /\bADR\b|#\d+|HTTP \d{3}|\/v1\/|\bat \w+ \(|Error:|—/,
    );
  });
});
