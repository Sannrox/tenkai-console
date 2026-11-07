import { readFile } from "node:fs/promises";
import { type IncomingMessage, type Server, createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { type Page, expect } from "@playwright/test";

/** One mocked API answer; `undefined` from a route handler means "not mocked". */
export type Reply = { status: number; body: unknown };
export type Routes = (path: string, request: IncomingMessage) => Reply | undefined;

/** What the console sent, for asserting the requests a scenario made. */
export type Sent = { method: string; path: string; authorization: string | undefined };

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
      const path = new URL(request.url ?? "/", "http://local").pathname;
      const json = ({ status, body }: Reply) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(body));
      };
      if (path === "/healthz" || path.startsWith("/v1/")) {
        sent.push({
          method: request.method ?? "GET",
          path,
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
