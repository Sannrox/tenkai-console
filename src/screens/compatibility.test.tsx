// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Compatibility } from "./compatibility";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PASS = {
  version: 1,
  release_digest: "8f3a",
  failures: [],
  satisfied_by: { database: "postgres@16.2.0", catalog: "catalog@1.4.0" },
};

const BLOCKED = {
  version: 1,
  release_digest: "8f3a",
  failures: [
    { reason: "missing_contract", contract: "analytics" },
    { reason: "incompatible_contract", contract: "payments" },
  ],
  satisfied_by: { catalog: "catalog@1.4.0" },
};

let root: Root;
let container: HTMLElement;

const settle = async () => {
  for (let round = 0; round < 5; round += 1) {
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
  }
};

const serve = (reply: (path: string) => { status: number; body: unknown } | "throw") => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const path = url.pathname.replace(/^\//, "");
      const answer = reply(path);
      if (answer === "throw") {
        throw new TypeError("Failed to fetch");
      }
      return new Response(JSON.stringify(answer.body), { status: answer.status });
    }),
  );
};

const render = async (ui: ReactNode) => {
  await act(async () => {
    root.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        {ui}
      </QueryClientProvider>,
    );
  });
  await settle();
};

const typeRelease = async (value: string) => {
  const input = container.querySelector<HTMLInputElement>('input[aria-label="Release to check"]');
  await act(async () => {
    // React tracks an input's value; only the native setter lets it see the change.
    // oxlint-disable-next-line typescript/unbound-method -- called with the input as `this`
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
};

const row = (name: string) =>
  [...container.querySelectorAll("table tbody tr")].find(
    (entry) => entry.querySelector("td")?.textContent === name,
  );

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("Compatibility", () => {
  it("shows matched providers, blocked copy, and the selected environment document", async () => {
    serve((path) =>
      path.includes("/prod/") ? { status: 200, body: PASS } : { status: 200, body: BLOCKED },
    );
    await render(<Compatibility token="" environments={["prod", "edge-1"]} />);
    expect(container.textContent).toMatch(/Status[\s\S]*Matched[\s\S]*Failures/);
    await typeRelease("shop@2.1.0");
    expect(container.textContent).toContain("compatible");
    expect(container.textContent).toContain("postgres@16.2.0 · catalog@1.4.0");
    expect(container.textContent).toContain("matched");
    expect(container.textContent).toContain("database");
    await act(async () => {
      row("edge-1")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await settle();
    expect(container.textContent).toContain("blocked");
    expect(container.textContent).toContain("analytics missing");
    expect(container.textContent).toContain("payments incompatible");
    expect(container.textContent).not.toMatch(/_contract|HTTP \d{3}|\/v1\/|—/);
  });

  it("says no profile when the server returns null", async () => {
    serve(() => ({ status: 200, body: null }));
    await render(<Compatibility token="" environments={["prod"]} />);
    await typeRelease("notes@0.3.1");
    expect(container.textContent).toContain("no profile");
    expect(container.textContent).not.toContain("Contract");
  });

  it("keeps matched empty when the report omits satisfied_by", async () => {
    serve(() => ({ status: 200, body: { version: 1, release_digest: "8f3a", failures: [] } }));
    await render(<Compatibility token="" environments={["prod"]} />);
    await typeRelease("shop@2.1.0");
    expect(container.textContent).toContain("compatible");
    expect(row("prod")?.textContent).toContain("none");
    expect(container.textContent).toMatch(/prod[\s\S]*none/);
  });

  it("says could not load when fetch throws", async () => {
    serve(() => "throw");
    await render(<Compatibility token="" environments={["prod"]} />);
    await typeRelease("shop@2.1.0");
    expect(container.textContent).toContain("Could not load");
    expect(container.textContent).not.toContain("Failed to fetch");
    expect(container.textContent).not.toMatch(/\bLoading\b/);
  });

  it("says no access when the read is refused", async () => {
    serve(() => ({ status: 403, body: { error: "denied" } }));
    await render(<Compatibility token="" environments={["prod"]} />);
    await typeRelease("shop@2.1.0");
    expect(container.textContent).toContain("No access");
    expect(container.textContent).not.toContain("denied");
  });
});
