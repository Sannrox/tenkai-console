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
  preview: {
    already_bound: false,
    bundle_digest: "sha256:b1",
    carries_revocations: false,
    plan_id: "p1",
    release_ids: [],
  },
  ...overrides,
});

type Call = { method: string; path: string; body: unknown };
let calls: Call[];
/** What `GET /v1/imports` answers: the host's jobs, newest first. */
let listed: ImportJob[];
let root: Root;
let container: HTMLElement;

const serve = (
  onPost: (body: { dry_run: boolean }) => { status?: number; body: unknown },
  existing: ImportJob[] = [],
) => {
  calls = [];
  listed = existing;
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
        if ((reply.status ?? 200) === 200) {
          const started = reply.body as ImportJob;
          listed = [started, ...listed.filter((other) => other.id !== started.id)];
        }
        return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
      }
      const body =
        call.path === "v1/imports/staged"
          ? STAGED
          : call.path === "v1/imports"
            ? { jobs: listed }
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
      body: body.dry_run
        ? job({})
        : job({ id: "job-2", dry_run: false, state: "succeeded", started_at_ms: 2 }),
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

  it("places bundles from the host's job list after a reload, dry run and import kept apart", async () => {
    STAGED.push({
      file: "other.tar",
      size_bytes: 10,
      chunked: false,
      environment: "site",
      plan_id: "p1",
    });
    try {
      serve(
        () => ({ body: job({}) }),
        [
          job({
            id: "imp-b",
            bundle: "other.tar",
            dry_run: false,
            state: "succeeded",
            started_at_ms: 3,
          }),
          job({ id: "imp-b-dry", bundle: "other.tar", started_at_ms: 2 }),
          job({ id: "imp-a-dry", started_at_ms: 1 }),
        ],
      );
      await render();
      expect(column("Checked (dry run passed)")).toContain("site.tar");
      expect(
        container.querySelector<HTMLInputElement>('input[aria-label="Upgrade for site.tar"]')
          ?.value,
      ).toBe("u1");
      expect(column("Imported")).toContain("other.tar");
      expect(column("Imported")).toContain("import succeeded");
      expect(container.querySelector('[aria-label="Job scope"]')?.textContent).toContain(
        "each server lists the imports it ran",
      );
    } finally {
      STAGED.pop();
    }
  });

  it("shows each entry's progress while an import runs, until it finishes", async () => {
    const running = job({
      dry_run: false,
      state: "running",
      progress: [
        { digest: "sha256:l1", kind: "layer", bytes_done: 1_024, bytes_total: 4_096 },
        { digest: "sha256:w1", kind: "weights", bytes_done: 0, bytes_total: 2_048 },
      ],
    });
    serve(() => ({ body: job({}) }), [running]);
    await render();
    const progress = () =>
      [...container.querySelectorAll('[aria-label="Progress of site.tar"] li')].map(
        (item) => item.textContent,
      );
    const tick = async () => {
      await act(async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, 1_100);
        });
      });
      await settle();
    };
    expect(progress()).toStrictEqual([
      "layer sha256:l1 1.0 KB / 4.0 KB (25%)",
      "weights sha256:w1 0 B / 2.0 KB (0%)",
    ]);
    listed = [
      {
        ...running,
        progress: [
          { digest: "sha256:l1", kind: "layer", bytes_done: 4_096, bytes_total: 4_096 },
          { digest: "sha256:w1", kind: "weights", bytes_done: 1_024, bytes_total: 2_048 },
        ],
      },
    ];
    await tick();
    expect(progress()).toStrictEqual([
      "layer sha256:l1 4.0 KB / 4.0 KB (100%)",
      "weights sha256:w1 1.0 KB / 2.0 KB (50%)",
    ]);
    listed = [{ ...running, state: "succeeded" }];
    await tick();
    expect(progress()).toStrictEqual([]);
    expect(column("Imported")).toContain("site.tar");
    const reads = calls.filter((call) => call.path === "v1/imports").length;
    await tick();
    expect(calls.filter((call) => call.path === "v1/imports").length).toBe(reads);
  });

  it("reloads the inventory when one of two running imports finishes", async () => {
    STAGED.push({
      file: "other.tar",
      size_bytes: 10,
      chunked: false,
      environment: "site",
      plan_id: "p1",
    });
    try {
      const first = job({ id: "imp-a", dry_run: false, state: "running" });
      const second = job({ id: "imp-b", bundle: "other.tar", dry_run: false, state: "running" });
      serve(() => ({ body: job({}) }), [first, second]);
      await render();
      const inventoryReads = () =>
        calls.filter((call) => call.path === "v1/content/inventory").length;
      const before = inventoryReads();
      listed = [{ ...first, state: "succeeded" }, second];
      await act(async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, 1_100);
        });
      });
      await settle();
      expect(column("Imported")).toContain("site.tar");
      expect(inventoryReads()).toBeGreaterThan(before);
    } finally {
      STAGED.pop();
    }
  });

  it("reloads the inventory when a polled job finishes", async () => {
    serve((body) => ({ body: job({ dry_run: body.dry_run, state: "running" }) }));
    await render();
    await type("Upgrade for site.tar", "u1");
    await click("Dry run");
    const inventoryReads = () =>
      calls.filter((call) => call.path === "v1/content/inventory").length;
    const before = inventoryReads();
    listed = [job({ state: "previewed" })];
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
