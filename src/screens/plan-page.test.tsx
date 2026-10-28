// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanApprovalsView } from "../api/tenkai.gen";
import { PlanPage } from "./plan-page";

// React's act() needs this flag outside a test renderer.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const REPORT = {
  name: "prod",
  lease: { held: false },
  subscriptions: [],
  latest_plan: {
    id: "tenkai:plan:1",
    state: "computed",
    created_at: 1,
    step_count: 1,
    digest: "sha256:abc",
  },
};

const APPROVALS: PlanApprovalsView = {
  plan_id: "tenkai:plan:1",
  plan_digest: "sha256:abc",
  purpose: "execute_plan",
  required: 3,
  groups: ["quality", "ops"],
  exclude_requester: true,
  collected: [
    {
      key_id: "k1",
      signer_identity: "alice",
      groups: ["quality"],
      expires_at: Date.UTC(2026, 10, 1),
    },
  ],
  missing: 2,
};

let root: Root;
let container: HTMLElement;

const serve = (approvals: unknown) =>
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
      const body = url.includes("/approvals")
        ? approvals
        : url.endsWith("/approval-policy")
          ? { configured: true, mode: "human" }
          : REPORT;
      return new Response(JSON.stringify(body));
    }),
  );

const render = async () => {
  const rootRoute = createRootRoute({
    component: () => <PlanPage environment="prod" token="operator" />,
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
  });
  for (let round = 0; round < 8; round += 1) {
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
  }
};

const type = async (label: string, value: string) => {
  const area = container.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`);
  await act(async () => {
    // React tracks a field's value; only the native setter lets it see the change.
    // oxlint-disable-next-line typescript/unbound-method -- called with the field as `this`
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(area, value);
    area?.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const apply = () =>
  [...container.querySelectorAll("button")].find((button) => button.textContent === "Apply");

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
});

describe("PlanPage approvals", () => {
  it("shows collected signers by group and keeps Apply disabled while two are missing", async () => {
    serve(APPROVALS);
    await render();
    const table = container.querySelector('table[aria-label="Approvals by group"]');
    expect(
      [...(table?.querySelectorAll("th") ?? [])].map((cell) => cell.textContent),
    ).toStrictEqual(["Signer", "quality 1", "ops 0", "Valid until"]);
    expect(
      [...(table?.querySelectorAll("tbody td") ?? [])].map((cell) => cell.textContent),
    ).toStrictEqual(["alice", "approved", "n/a", "2026-11-01T00:00:00.000Z"]);
    expect(container.querySelector('[aria-label="Quorum"]')?.textContent).toBe(
      "1 of 3 approvals counted; 2 missing. The apply requester's own approval does not count.",
    );
    await type("Approval envelope", "{}");
    await type("Approval trust roots", "x");
    expect(apply()?.disabled).toBe(true);
  });

  it("lets the last approval be pasted and applied; the server still enforces quorum", async () => {
    serve({ ...APPROVALS, required: 2, missing: 1, exclude_requester: false });
    await render();
    await type("Approval envelope", "{}");
    await type("Approval trust roots", "x");
    expect(apply()?.disabled).toBe(false);
  });

  it("shows the server's refusal instead of the matrix", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url =
          input instanceof Request ? input.url : input instanceof URL ? input.href : input;
        return url.includes("/approvals")
          ? new Response(JSON.stringify({ error: "insufficient delivery capability" }), {
              status: 403,
            })
          : new Response(JSON.stringify(REPORT));
      }),
    );
    await render();
    expect(container.querySelector('[aria-label="Approvals"]')?.textContent).toBe(
      "Approvals: insufficient delivery capability",
    );
    expect(container.querySelector('table[aria-label="Approvals by group"]')).toBeNull();
  });
});
