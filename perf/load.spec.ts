// Browser load measurement (#21, #45): sign-in to first table, and the
// environments and releases screens at fleet scale, on a throttled mid-range
// CPU, against a mocked API serving 1 000 environments and a 50 x 10 product
// x channel matrix. Run with `pnpm build && pnpm perf:load`.
import { expect, test } from "@playwright/test";
import { type MockBackend, type Routes, serveConsole } from "../e2e/mock-backend";
import type {
  ChannelListEntry,
  EnvironmentInspectReport,
  EnvironmentListEntry,
  EnvironmentSubscriptionView,
  FleetEnvironmentRow,
} from "../src/api/tenkai.gen";

const ENVIRONMENTS = 1_000;
const PRODUCTS = 50;
const CHANNELS = 10;
/** Budgets from the issue's acceptance evidence. */
const FIRST_TABLE_MS = 1_500;
const ENVIRONMENTS_INTERACTIVE_MS = 300;
const LONG_TASK_MS = 50;

const name = (index: number) => `env-${String(index).padStart(4, "0")}`;
/** Two in three are deployed at the channel head; the rest are missing. */
const subscription = (index: number): EnvironmentSubscriptionView => {
  const deployed = index % 3 !== 0;
  return {
    product: `product-${index % PRODUCTS}`,
    channel: `channel-${Math.floor(index / PRODUCTS) % CHANNELS}`,
    head: "1.0.0",
    deployed: deployed ? "1.0.0" : null,
    state: deployed ? "current" : "missing",
  };
};
const listEntry = (index: number): EnvironmentListEntry => ({
  id: `env:${name(index)}`,
  name: name(index),
  description: "fixture",
  lease_held: false,
  subscription_count: 1,
  deployed_product_count: index % 3 !== 0 ? 1 : 0,
});
const inspect = (index: number): EnvironmentInspectReport => ({
  id: `env:${name(index)}`,
  name: name(index),
  description: "fixture",
  execution_note: "",
  facts: { architecture: "arm64" },
  lease: { held: false, status: "free" },
  latest_plan: null,
  subscriptions: [subscription(index)],
});
const fleetRow = (index: number): FleetEnvironmentRow => {
  const current = index % 3 !== 0;
  return {
    id: `env:${name(index)}`,
    name: name(index),
    description: "fixture",
    subscription_count: 1,
    products_current: current ? 1 : 0,
    products_behind: 0,
    products_missing: current ? 0 : 1,
    unhealthy: false,
    health_summary: "ok",
    lease_held: false,
    posture: current ? "current" : "behind",
  };
};
const channelItems = (): ChannelListEntry[] => {
  const items: ChannelListEntry[] = [];
  for (let product = 0; product < PRODUCTS; product += 1) {
    for (let channel = 0; channel < CHANNELS; channel += 1) {
      items.push({
        id: `channel:product-${product}/channel-${channel}`,
        product: `product-${product}`,
        name: `channel-${channel}`,
        head: "1.0.0",
      });
    }
  }
  return items;
};

/** The fleet-scale API; everything else is the shared mock backend's default. */
const routes: Routes = (path) => {
  if (path === "/v1/auth/oidc") {
    return { status: 404, body: { error: "no oidc client" } };
  }
  if (path === "/v1/fleet/status") {
    const environments = Array.from({ length: ENVIRONMENTS }, (_, index) => fleetRow(index));
    const behind = environments.filter((row) => row.posture === "behind").length;
    return {
      status: 200,
      body: {
        environments,
        environment_count: ENVIRONMENTS,
        environments_current: ENVIRONMENTS - behind,
        environments_behind: behind,
        environments_unhealthy: 0,
        environments_empty: 0,
      },
    };
  }
  if (path === "/v1/channels") {
    return { status: 200, body: { items: channelItems() } };
  }
  if (path === "/v1/environments") {
    return {
      status: 200,
      body: Array.from({ length: ENVIRONMENTS }, (_, index) => listEntry(index)),
    };
  }
  const runtime = path.match(/^\/v1\/environments\/env-(\d{4})\/runtime$/);
  if (runtime) {
    return { status: 200, body: { environment: name(Number(runtime[1])), components: [] } };
  }
  const environment = path.match(/^\/v1\/environments\/env-(\d{4})$/);
  if (environment) {
    return { status: 200, body: inspect(Number(environment[1])) };
  }
  return undefined;
};

let app: MockBackend;
test.beforeAll(async () => {
  app = await serveConsole(routes);
});
test.afterAll(async () => {
  await app.close();
});

test("fleet-scale screens stay within the load budget", async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  // A mid-range laptop: four times slower than the runner's CPU.
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.goto(app.url);
  await page.getByLabel("Platform token").fill("fixture-token");

  const signedIn = Date.now();
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("table tbody tr").first()).toBeVisible({ timeout: 30_000 });
  const firstTable = Date.now() - signedIn;

  await expect(page.getByText("Loading")).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByText(/1000 environments/)).toBeVisible();
  const opened = Date.now();
  await page.getByRole("link", { name: "Environments" }).click();
  await expect(page.getByText("1000 active")).toBeVisible({ timeout: 30_000 });
  const scroller = page.getByRole("region", { name: "Environments" });
  await expect(scroller.locator("tbody tr").first()).toBeVisible();
  const environments = Date.now() - opened;

  await page.evaluate(() => {
    const tasks: number[] = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        tasks.push(entry.duration);
      }
    }).observe({ type: "longtask" });
    (window as unknown as { longTasks: number[] }).longTasks = tasks;
  });
  for (let step = 0; step < 20; step += 1) {
    await scroller.evaluate((node) => {
      node.scrollTop += 1_500;
    });
    await page.waitForTimeout(50);
  }
  const longest = Math.max(
    0,
    ...(await page.evaluate(() => (window as unknown as { longTasks: number[] }).longTasks)),
  );

  await page.getByRole("link", { name: "Releases" }).click();
  await expect(page.locator("table").first().locator("tbody tr")).toHaveCount(PRODUCTS, {
    timeout: 30_000,
  });

  console.log(
    JSON.stringify({
      first_table_ms: firstTable,
      environments_ms: environments,
      longest_task_ms: longest,
    }),
  );
  expect(firstTable).toBeLessThanOrEqual(FIRST_TABLE_MS);
  expect(environments).toBeLessThanOrEqual(ENVIRONMENTS_INTERACTIVE_MS);
  expect(longest).toBeLessThanOrEqual(LONG_TASK_MS);
});
