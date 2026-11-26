import { readFile } from "node:fs/promises";
import { type IncomingMessage, type Server, createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { type Page, expect } from "@playwright/test";

/** One mocked API answer; `undefined` from a route handler means "not mocked". */
export type Reply = { status: number; body: unknown };
export type Routes = (path: string, request: IncomingMessage) => Reply | undefined;

/** What the console sent, for asserting the requests a scenario made. */
export type Sent = {
  method: string;
  path: string;
  search: string;
  authorization: string | undefined;
};

export type MockBackend = { url: string; sent: Sent[]; close: () => Promise<void> };

const contentTypes: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
};

export const HEALTHZ: Reply = {
  status: 200,
  body: { status: "ok", profile: "fixture", capabilities: [], contracts: ["tenkai.http.v1"] },
};

/**
 * Serves a built console at /ui/ and a mocked API at /, as tenkai-server does,
 * on an ephemeral loopback port. `/healthz` and unmocked `/v1/` routes default
 * to a compatible server and 404.
 */
export const serveConsole = (routes: Routes, dist = "dist") =>
  new Promise<MockBackend>((resolve) => {
    const sent: Sent[] = [];
    const server: Server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://local");
      const path = url.pathname;
      const json = ({ status, body }: Reply) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(body));
      };
      if (path === "/healthz" || path.startsWith("/v1/")) {
        sent.push({
          method: request.method ?? "GET",
          path,
          search: url.search,
          authorization: request.headers.authorization,
        });
        json(
          routes(path, request) ??
            (path === "/healthz" ? HEALTHZ : { status: 404, body: { error: "not found" } }),
        );
        return;
      }
      const file = normalize(path.replace(/^\/ui\/?/, "") || "index.html");
      readFile(join(dist, file.endsWith("/") || file === "." ? "index.html" : file))
        .then((body) => {
          response.writeHead(200, { "content-type": contentTypes[extname(file)] ?? "text/html" });
          response.end(body);
        })
        .catch(() => readFile(join(dist, "index.html")).then((body) => response.end(body)));
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}/ui/`,
        sent,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });

// Visible text must not leak internals: decision or issue numbers, raw
// statuses, API paths, or stack traces. Copy rules ban em dashes.
const INTERNAL = /\bADR\b|#\d+|HTTP \d{3}|\/v1\/|\bat \w+ \(|Error:|—/;

/** Design rules every console scenario holds to, at any viewport. */
export const expectDesignRules = async (page: Page) => {
  expect(await page.locator("body").textContent()).not.toMatch(INTERNAL);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
};

/** Opens a sidebar place. On a phone, Env and Rel are on the bar; the rest go through More. */
export const openApp = async (
  page: Page,
  name: "Environments" | "Releases" | "Exposure" | "Runners" | "Platform",
) => {
  const main = page.getByRole("navigation", { name: "Main" });
  const fromMain = main.getByRole("link", { name, exact: true });
  const short = name === "Environments" ? "Env" : name === "Releases" ? "Rel" : undefined;
  const fromPhone = short
    ? main.getByRole("link", { name: short, exact: true })
    : main.getByRole("link", { name: "More" });
  await fromMain.or(fromPhone).waitFor();
  if (await fromMain.isVisible()) {
    await fromMain.click();
    return;
  }
  await fromPhone.click();
  if (!short) {
    await page.getByRole("link", { name, exact: true }).click();
  }
};

/** List, then the named environment object page. */
export const openEnvironment = async (page: Page, name = "prod") => {
  await openApp(page, "Environments");
  await page
    .getByRole("region", { name: "Environments" })
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name, exact: true }) })
    .first()
    .click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
};

export type EnvironmentTab =
  | "Overview"
  | "Instances"
  | "History"
  | "Settings"
  | "Security"
  | "Linked";

/** Object-page tab by visible name. */
export const openEnvironmentTab = async (page: Page, tab: EnvironmentTab) => {
  await page
    .getByRole("navigation", { name: "Environment" })
    .getByRole("link", { name: tab, exact: true })
    .click();
};

/** Heading corner Actions. The menu stays open until the caller picks an item. */
export const openActions = async (page: Page) => {
  await page.getByRole("button", { name: "Actions" }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
};
