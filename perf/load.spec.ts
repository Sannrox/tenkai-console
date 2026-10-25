import { readFile } from "node:fs/promises";
// Browser load measurement (#21): sign-in to first table, and the environments
// and releases screens at fleet scale, on a throttled mid-range CPU, against a
// mocked API serving 1 000 environments and a 50 x 10 product x channel matrix.
// Run with `pnpm build && pnpm perf:load`; it prints the timings. The budgets
// are enforced once fleet-scale loading lands (#45); until then
// `PERF_ENFORCE=1` checks them.
import { type Server, createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { expect, test } from "@playwright/test";
import type {
  EnvironmentInspectReport,
  EnvironmentListEntry,
  EnvironmentSubscriptionView,
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

const contentTypes: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
};

/** Serves dist/ at /ui/ and the API at /, as tenkai-server does. */
const serve = () =>
  new Promise<{ server: Server; url: string }>((resolve) => {
    const server = createServer((request, response) => {
      const path = new URL(request.url ?? "/", "http://local").pathname;
      const json = (status: number, body: unknown) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(body));
      };
      if (path === "/healthz") {
        return json(200, {
          status: "ok",
          profile: "fixture",
          capabilities: [],
          contracts: ["tenkai.http.v1"],
        });
      }
      if (path === "/v1/auth/oidc") {
        return json(404, { error: "no oidc client" });
      }
      if (path === "/v1/fleet/status") {
        return json(200, { environments: [] });
      }
      if (path === "/v1/environments") {
        return json(
          200,
          Array.from({ length: ENVIRONMENTS }, (_, index) => listEntry(index)),
        );
      }
      const runtime = path.match(/^\/v1\/environments\/env-(\d{4})\/runtime$/);
      if (runtime) {
        return json(200, { environment: name(Number(runtime[1])), components: [] });
      }
      const environment = path.match(/^\/v1\/environments\/env-(\d{4})$/);
      if (environment) {
        return json(200, inspect(Number(environment[1])));
      }
      const file = normalize(path.replace(/^\/ui\/?/, "") || "index.html");
      readFile(join("dist", file.endsWith("/") || file === "." ? "index.html" : file))
        .then((body) => {
          response.writeHead(200, {
            "content-type": contentTypes[extname(file)] ?? "text/html",
          });
          response.end(body);
        })
        .catch(() => readFile("dist/index.html").then((body) => response.end(body)));
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}/ui/` });
    });
  });

let app: { server: Server; url: string };
test.beforeAll(async () => {
  app = await serve();
});
test.afterAll(() => {
  app.server.close();
});

test("fleet-scale screens stay within the load budget", async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  // A mid-range laptop: four times slower than the runner's CPU.
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.goto(app.url);
  await page.getByLabel("Bearer token").fill("fixture-token");

  const signedIn = Date.now();
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("table tbody tr").first()).toBeVisible({ timeout: 30_000 });
  const firstTable = Date.now() - signedIn;

  // Every inspect has arrived once the home screen stops loading.
  await expect(page.getByText("Loading")).toHaveCount(0, { timeout: 60_000 });
  const opened = Date.now();
  await page.getByRole("link", { name: "Environments" }).click();
  const rows = page.locator("table").first().locator("tbody tr");
  await expect(rows).toHaveCount(ENVIRONMENTS, { timeout: 30_000 });
  const environments = Date.now() - opened;

  // Long tasks while scrolling the full table.
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
    await page.mouse.wheel(0, 1_500);
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
  if (process.env.PERF_ENFORCE === "1") {
    expect(firstTable).toBeLessThanOrEqual(FIRST_TABLE_MS);
    expect(environments).toBeLessThanOrEqual(ENVIRONMENTS_INTERACTIVE_MS);
    expect(longest).toBeLessThanOrEqual(LONG_TASK_MS);
  }
});
