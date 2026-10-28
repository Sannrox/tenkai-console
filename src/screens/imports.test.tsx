// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContentInventory, ImportJob, StagedBundle } from "../api/tenkai.gen";
import { useSession } from "../auth/session";
import { Imports } from "./imports";

// React's act() needs this flag outside a test renderer.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const STAGED: StagedBundle[] = [
  { file: "site.tar", size_bytes: 2_048, chunked: true, environment: "site", plan_id: "p1" },
];

const INVENTORY: ContentInventory = {
  oci_store_bytes: 4_096,
  missing: ["app 1.0.0 sha256:w1"],
  releases: [
    {
      id: "r1",
      product: "app",
      version: "1.0.0",
      referenced_by: ["deployed site"],
      content: [{ digest: "sha256:l1", kind: "layer", size_bytes: 1_024, stored: true }],
    },
  ],
};

const job = (overrides: Partial<ImportJob>): ImportJob => ({
  schema: "tenkai.import-job.v1",
  id: "job-1",
  bundle: "site.tar",
  upgrade: "u1",
  environment: "site",
  dry_run: true,
  state: "previewed",
  actor: "alice",
  started_at_ms: 1,
  ...overrides,
});

type Call = { method: string; path: string; body: unknown };
let calls: Call[];
/** The job a GET of `/v1/imports/{id}` answers: the last one started. */
let lastJob: unknown;
let root: Root;
let container: HTMLElement;

const serve = (onPost: (body: { dry_run: boolean }) => { status?: number; body: unknown }) => {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const call = {
        method: init?.method ?? "GET",
        path: url.pathname.replace(/^\//, ""),
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      };
      calls.push(call);
      if (call.method === "POST") {
        const reply = onPost(call.body as { dry_run: boolean });
        lastJob = reply.body;
        return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
      }
      const body =
        call.path === "v1/imports/staged"
          ? STAGED
          : call.path.startsWith("v1/imports/")
            ? lastJob
            : INVENTORY;
      return new Response(JSON.stringify(body));
    }),
  );
};

const settle = async () => {
  for (let round = 0; round < 6; round += 1) {
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
  }
};

const column = (title: string) =>
  container.querySelector(`section[aria-label="${title}"]`)?.textContent ?? "";

const button = (label: string) =>
  [...container.querySelectorAll("button")].find((element) => element.textContent === label);

const click = async (label: string) => {
  await act(async () => {
    button(label)?.click();
  });
  await settle();
};

const type = async (label: string, value: string) => {
  const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  await act(async () => {
    // React tracks an input's value; only the native setter lets it see the change.
    // oxlint-disable-next-line typescript/unbound-method -- called with the input as `this`
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  useSession.setState({
    session: {
      kind: "token",
      accessToken: "operator",
      subject: undefined,
      expiresAt: undefined,
      refreshToken: undefined,
      idToken: undefined,
    },
    refused: [],
  });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
});

const render = async () => {
  await act(async () => {
    root.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { mutations: { networkMode: "always" } } })}
      >
        <Imports />
      </QueryClientProvider>,
    );
  });
  await settle();
};

describe("Imports", () => {
  it("moves a bundle from staged to checked to imported, and shows the content inventory", async () => {
    serve((body) => ({
      body: body.dry_run ? job({}) : job({ dry_run: false, state: "succeeded", started_at_ms: 2 }),
    }));
    await render();
    expect(column("Staged")).toContain("site.tar");
    await type("Upgrade for site.tar", "u1");
    await click("Dry run");
    expect(calls.find((call) => call.method === "POST")?.body).toStrictEqual({
      version: 1,
      operation: "import",
      bundle: "site.tar",
      environment: "site",
      upgrade: "u1",
      dry_run: true,
    });
    expect(column("Checked (dry run passed)")).toContain("site.tar");
    await click("Import");
    await click("Import into site");
    expect(column("Imported")).toContain("site.tar");
    expect(container.querySelector('[aria-label="Space used"]')?.textContent).toBe(
      "Used: OCI store 4.0 KB, weight cache not configured",
    );
    expect(
      [...container.querySelectorAll('table[aria-label="Content inventory"] tbody td')].map(
        (cell) => cell.textContent,
      ),
    ).toStrictEqual(["app 1.0.0", "layer", "sha256:l1", "1.0 KB", "held", "deployed site"]);
    expect(container.querySelector('[aria-label="Missing content"]')?.textContent).toBe(
      "Missing here: app 1.0.0 sha256:w1",
    );
  });

  it("keeps a refused bundle where it was, with the refusal naming the digest", async () => {
    serve(() => ({ body: job({ state: "failed", refusal: "missing layer sha256:abc" }) }));
    await render();
    await type("Upgrade for site.tar", "u1");
    await click("Dry run");
    expect(column("Staged")).toContain("dry run failed: missing layer sha256:abc");
    expect(column("Checked (dry run passed)")).not.toContain("site.tar");
  });

  it("shows the server's refusal of the request itself", async () => {
    serve(() => ({ status: 409, body: { error: "an import is already running" } }));
    await render();
    await type("Upgrade for site.tar", "u1");
    await click("Dry run");
    expect(column("Staged")).toContain("an import is already running");
  });

  it("needs a new dry run once the upgrade changes after a passing one", async () => {
    serve(() => ({ body: job({}) }));
    await render();
    await type("Upgrade for site.tar", "u1");
    await click("Dry run");
    expect(column("Checked (dry run passed)")).toContain("site.tar");
    await type("Upgrade for site.tar", "u2");
    expect(column("Checked (dry run passed)")).not.toContain("site.tar");
    expect(column("Staged")).toContain("site.tar");
    expect(button("Import")).toBeUndefined();
    expect(button("Dry run")).toBeDefined();
  });

  it("reloads the inventory when a polled job finishes", async () => {
    serve((body) => ({ body: job({ dry_run: body.dry_run, state: "running" }) }));
    await render();
    await type("Upgrade for site.tar", "u1");
    await click("Dry run");
    const inventoryReads = () =>
      calls.filter((call) => call.path === "v1/content/inventory").length;
    const before = inventoryReads();
    lastJob = job({ state: "previewed" });
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 1_100);
      });
    });
    await settle();
    expect(column("Checked (dry run passed)")).toContain("site.tar");
    expect(inventoryReads()).toBeGreaterThan(before);
  });
});
