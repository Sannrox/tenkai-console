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
    ).toStrictEqual(["alice", "signed", "n/a", "2026-11-01T00:00:00.000Z"]);
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

  it("lists every eligible approver with signed times and pending cells", async () => {
    serve({
      ...APPROVALS,
      collected: [{ ...APPROVALS.collected?.[0], signed_at: Date.UTC(2026, 9, 28, 9) }],
      eligible: [
        {
          group: "quality",
          approvers: [{ identity: "alice", key_id: "k1", collected: true }],
        },
        { group: "ops", approvers: [{ identity: "bob", key_id: "k2", collected: false }] },
      ],
    });
    await render();
    const rows = [
      ...(container.querySelectorAll('table[aria-label="Approvals by group"] tbody tr') ?? []),
    ].map((row) => [...row.querySelectorAll("td")].map((cell) => cell.textContent));
    expect(rows).toStrictEqual([
      ["alice", "2026-10-28T09:00:00.000Z", "n/a", "2026-11-01T00:00:00.000Z"],
      ["bob", "n/a", "pending", ""],
    ]);
  });
});

describe("PlanPage overlay schema", () => {
  it("shows the failing key and reason instead of the server sentence", async () => {
    const inspect = {
      ...REPORT,
      subscriptions: [{ product: "api", channel: "stable", head: "2.0.0", state: "behind" }],
      config: [{ product: "api", overlay: { region: "eu" }, secrets: ["db-password"] }],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const url =
          input instanceof Request ? input.url : input instanceof URL ? input.href : input;
        const method = init?.method ?? (input instanceof Request ? input.method : "GET");
        if (typeof url === "string" && url.includes("/plans") && method === "POST") {
          return new Response(
            JSON.stringify({ error: "overlay replicas is required by the release config schema" }),
            { status: 409 },
          );
        }
        if (typeof url === "string" && url.includes("/approvals")) {
          return new Response(JSON.stringify(APPROVALS));
        }
        if (typeof url === "string" && url.endsWith("/approval-policy")) {
          return new Response(JSON.stringify({ configured: true, mode: "human" }));
        }
        return new Response(JSON.stringify(inspect));
      }),
    );
    await render();
    const plan = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Plan again",
    );
    await act(async () => {
      plan?.click();
    });
    for (let round = 0; round < 5; round += 1) {
      await act(async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, 0);
        });
      });
    }
    const overlays = container.querySelector('table[aria-label="Overlays"]');
    expect(overlays?.textContent).toContain("replicas");
    expect(overlays?.textContent).toContain("required");
    expect(overlays?.textContent).toContain("2.0.0");
    expect(container.textContent).not.toContain("release config schema");
  });
});

const ENVELOPE = JSON.stringify({
  schema: "tenkai.plan-approval.v1",
  key_id: "ops-1",
  signature: "c2ln",
  statement: {
    environment: "prod",
    expires_at: 2,
    issued_at: 1,
    plan_digest: "sha256:abc",
    policy_digest: "sha256:def",
    policy_evidence_id: "ev-1",
    policy_provider: "tenkai",
    purpose: "apply",
    skip_gates: false,
  },
});
const ROOTS = JSON.stringify({
  version: 1,
  signers: [{ identity: "ops", key_id: "ops-1", public_key: "k" }],
});

const READY = { ...APPROVALS, required: 1, missing: 0, exclude_requester: false };

const STEPS_REPORT = {
  ...REPORT,
  latest_plan: {
    ...REPORT.latest_plan,
    step_count: 2,
    steps: [
      {
        id: "s1",
        order: 1,
        product: "api",
        action: "upgrade",
        release_id: "rel:1",
        to: "1.1.0",
        instance: "api",
      },
      {
        id: "s2",
        order: 2,
        product: "web",
        action: "upgrade",
        release_id: "rel:2",
        to: "2.0.0",
        instance: "web",
      },
    ],
  },
};

const settle = async () => {
  for (let round = 0; round < 8; round += 1) {
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
  }
};

const serveApply = (inspect: unknown, reply: (url: string) => Response) =>
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      if (typeof url === "string" && url.includes("/apply") && method === "POST") {
        return reply(url);
      }
      if (typeof url === "string" && url.includes("/approvals")) {
        return new Response(JSON.stringify(READY));
      }
      if (typeof url === "string" && url.endsWith("/approval-policy")) {
        return new Response(JSON.stringify({ configured: true, mode: "human" }));
      }
      return new Response(JSON.stringify(inspect));
    }),
  );

const submitApply = async () => {
  await type("Approval envelope", ENVELOPE);
  await type("Approval trust roots", ROOTS);
  await act(async () => {
    apply()?.click();
  });
  await settle();
};

describe("PlanPage apply steps", () => {
  it("asks for steps and lists every outcome including not run", async () => {
    const posted: string[] = [];
    serveApply(STEPS_REPORT, (url) => {
      posted.push(url);
      return new Response(
        JSON.stringify({
          version: 1,
          operation: "apply",
          message: "applied",
          steps: [
            {
              product: "api",
              instance: "api",
              action: "upgrade",
              status: "succeeded",
              to_version: "1.1.0",
              attempt_id: "dep:api:1",
            },
          ],
        }),
      );
    });
    await render();
    await submitApply();
    expect(posted.some((url) => url.includes("/apply?steps=true"))).toBe(true);
    const table = container.querySelector('table[aria-label="Apply steps"]');
    expect(table?.textContent).toContain("succeeded");
    expect(table?.textContent).toContain("not run");
    expect(table?.textContent).toContain("dep:api:1");
    expect(container.querySelector('[role="status"]')?.textContent).toBe("applied");
  });

  it("lists failed and restored steps from a 422 body", async () => {
    serveApply(
      STEPS_REPORT,
      () =>
        new Response(
          JSON.stringify({
            error: "apply failed",
            steps: [
              {
                product: "api",
                instance: "api",
                action: "upgrade",
                status: "failed",
                to_version: "1.1.0",
                restored_version: "1.0.0",
                detail: "probe failed",
                detail_truncated: true,
                attempt_id: "dep:api:1",
              },
            ],
          }),
          { status: 422 },
        ),
    );
    await render();
    await submitApply();
    const table = container.querySelector('table[aria-label="Apply steps"]');
    expect(table?.textContent).toContain("failed");
    expect(table?.textContent).toContain("1.0.0");
    expect(table?.textContent).toContain("cut");
    expect(table?.textContent).toContain("not run");
    expect(container.querySelector('[role="status"]')?.textContent).toBe("apply failed");
  });

  it("keeps the message and says detail is unavailable on an older server", async () => {
    serveApply(
      STEPS_REPORT,
      () =>
        new Response(JSON.stringify({ version: 1, operation: "apply", message: "applied 1 step" })),
    );
    await render();
    await submitApply();
    expect(container.querySelector('[role="status"]')?.textContent).toBe("applied 1 step");
    expect(container.textContent).toContain("detail is unavailable");
    expect(container.querySelector('table[aria-label="Apply steps"]')).toBeNull();
  });

  it("shows no access when apply is forbidden", async () => {
    serveApply(
      STEPS_REPORT,
      () =>
        new Response(JSON.stringify({ error: "insufficient delivery capability" }), {
          status: 403,
        }),
    );
    await render();
    await submitApply();
    expect(container.querySelector('[role="status"]')?.textContent).toBe("No access");
    expect(container.textContent).not.toContain("insufficient delivery capability");
    expect(container.querySelector('table[aria-label="Apply steps"]')).toBeNull();
  });
});
