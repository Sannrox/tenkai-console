// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BackupStatus, ExportList } from "../api/tenkai.gen";
import { useSession } from "../auth/session";
import { Operations } from "./operations";

// React's act() needs this flag outside a test renderer.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BACKUPS: BackupStatus = {
  schema: "tenkai.backup-status.v1",
  last_success: {
    schema: "tenkai.backup.v1",
    file: "tenkai-1.db",
    sha256: "abc",
    size_bytes: 4_096,
    taken_at_ms: Date.UTC(2026, 9, 28),
  },
  drills: [
    {
      schema: "tenkai.restore-drill.v1",
      file: "tenkai-1.db",
      sha256: "abc",
      restored_at_ms: Date.UTC(2026, 9, 28, 1),
      integrity: "ok",
      environments: 2,
      releases: 3,
      plans: 4,
    },
    {
      schema: "tenkai.restore-drill.v1",
      file: "tenkai-0.db",
      sha256: "abd",
      restored_at_ms: Date.UTC(2026, 9, 27, 1),
      integrity: "ok",
      environments: 1,
      releases: 1,
      plans: 1,
    },
  ],
  last_drill: {
    schema: "tenkai.restore-drill.v1",
    file: "tenkai-1.db",
    sha256: "abc",
    restored_at_ms: Date.UTC(2026, 9, 28, 1),
    integrity: "ok",
    environments: 2,
    releases: 3,
    plans: 4,
  },
};

const EXPORTS: ExportList = {
  exports: [
    {
      schema: "tenkai.export.v1",
      id: "e1",
      kind: "support-bundle",
      file_name: "support.json",
      sha256: "abc",
      size_bytes: 512,
      created_at_ms: Date.UTC(2026, 9, 28),
      expired: false,
      events: [{ action: "created", at_ms: 1, principal: "alice", reason: "ticket 7" }],
    },
    {
      schema: "tenkai.export.v1",
      id: "e0",
      kind: "audit-export",
      file_name: "audit-00000001.json",
      audit_range: { from: 1, to: 1 },
      sha256: "def",
      size_bytes: 256,
      created_at_ms: Date.UTC(2026, 8, 1),
      expires_at_ms: Date.UTC(2026, 9, 1),
      expired: true,
      events: [{ action: "created", at_ms: 1, principal: "bob", reason: "audit" }],
    },
  ],
};

type Call = { method: string; path: string; authorization: string | null; body: unknown };

let root: Root;
let container: HTMLElement;
let calls: Call[];

const serve = (answer: (call: Call) => Response | undefined = () => undefined) => {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const call: Call = {
        method: init?.method ?? "GET",
        path: `${url.pathname.replace(/^\//, "")}${url.search}`,
        authorization: new Headers(init?.headers).get("authorization"),
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      };
      calls.push(call);
      const reply = answer(call);
      if (reply) {
        return reply;
      }
      const body = call.path.startsWith("healthz")
        ? { status: "ok", backup: { state: "ok", age_seconds: 7_200, max_age_seconds: 86_400 } }
        : call.path.startsWith("v1/backups")
          ? BACKUPS
          : EXPORTS;
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

const render = async () => {
  await act(async () => {
    root.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { mutations: { networkMode: "always" } } })}
      >
        <Operations />
      </QueryClientProvider>,
    );
  });
  await settle();
};

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
  serve();
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

describe("Operations", () => {
  it("shows the last backup as the server grades it, the last drill, and export history", async () => {
    await render();
    const backups = container.querySelector('table[aria-label="Backups"]');
    expect(
      [...(backups?.querySelectorAll("td") ?? [])].map((cell) => cell.textContent),
    ).toStrictEqual([
      "2026-10-28T00:00:00.000Z, 4.0 KB, 2h old, ok",
      "2026-10-28T01:00:00.000Z, tenkai-1.db, integrity ok, 2 environments, 3 releases, 4 plans2026-10-27T01:00:00.000Z, tenkai-0.db, integrity ok, 1 environments, 1 releases, 1 plans",
    ]);
    expect(
      [...container.querySelectorAll('[aria-label="Restore drills"] li')].map((item) =>
        item.textContent?.slice(0, 24),
      ),
    ).toStrictEqual(["2026-10-28T01:00:00.000Z", "2026-10-27T01:00:00.000Z"]);
    const history = container.querySelector('table[aria-label="Export history"] tbody tr');
    expect(
      [...(history?.querySelectorAll("td") ?? [])].map((cell) => cell.textContent),
    ).toStrictEqual([
      "2026-10-28T00:00:00.000Z",
      "alice",
      "support-bundle support.json",
      "ticket 7",
      "512 B",
      "0",
      "kept",
      "Download",
    ]);
    const expired = container.querySelectorAll('table[aria-label="Export history"] tbody tr')[1];
    expect(
      [...(expired?.querySelectorAll("td") ?? [])].map((cell) => cell.textContent),
    ).toStrictEqual([
      "2026-09-01T00:00:00.000Z",
      "bob",
      "audit-export 1 audit-00000001.json",
      "audit",
      "256 B",
      "0",
      "expired",
      "",
    ]);
  });

  it("takes a backup after confirmation and shows the server's refusal", async () => {
    serve((call) =>
      call.method === "POST"
        ? new Response(JSON.stringify({ error: "backups are not configured" }), { status: 409 })
        : undefined,
    );
    await render();
    await click("Back up now");
    expect(calls.some((call) => call.method === "POST")).toBe(false);
    await click("Take a backup now");
    expect(calls.filter((call) => call.method === "POST").map((call) => call.path)).toStrictEqual([
      "v1/backups",
    ]);
    expect(container.textContent).toContain("backups are not configured");
  });

  it("creates an export with its reason and only the fields its kind takes", async () => {
    serve((call) =>
      call.method === "POST" ? new Response(JSON.stringify(EXPORTS.exports[0])) : undefined,
    );
    await render();
    await type("Reason", "ticket 9");
    await type("Environment", "prod");
    const create = container.querySelector('table[aria-label="Export kinds"] tbody tr button');
    await act(async () => {
      (create as HTMLButtonElement | null)?.click();
    });
    await click("Create support-bundle");
    expect(calls.find((call) => call.method === "POST")).toMatchObject({
      path: "v1/exports",
      body: { kind: "support-bundle", reason: "ticket 9" },
    });
    expect(container.textContent).toContain("support.json created");
  });

  it("sends an audit range only once it is valid, and lists the range it covers", async () => {
    const ranged = {
      ...EXPORTS.exports[1],
      id: "e2",
      file_name: "audit-range-00000003-00000007.json",
      audit_range: { from: 3, to: 7 },
      expired: false,
    };
    serve((call) => (call.method === "POST" ? new Response(JSON.stringify(ranged)) : undefined));
    await render();
    await type("Reason", "review window");
    const auditRow = () =>
      [...container.querySelectorAll('table[aria-label="Export kinds"] tbody tr')].find((row) =>
        row.textContent?.startsWith("Audit export"),
      );
    await type("From sequence", "7");
    await type("To sequence", "3");
    expect(auditRow()?.textContent).toContain("from is 1 or more and no higher than to");
    expect(auditRow()?.querySelector("button")?.disabled).toBe(true);
    await type("From sequence", "3");
    await type("To sequence", "7");
    await act(async () => {
      auditRow()?.querySelector("button")?.click();
    });
    await click("Create audit-export");
    expect(calls.find((call) => call.method === "POST")).toMatchObject({
      path: "v1/exports",
      body: { kind: "audit-export", reason: "review window", from_sequence: 3, to_sequence: 7 },
    });
  });

  it("downloads with the bearer in a header and the reason in the query, never the token", async () => {
    const created: string[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
      created.push("blob:1");
      return "blob:1";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    await render();
    expect(button("Download")?.disabled).toBe(true);
    await type("Reason", "audit review");
    await click("Download");
    const fetched = calls.find((call) => call.path.includes("/download"));
    expect(fetched).toMatchObject({
      path: "v1/exports/e1/download?reason=audit%20review",
      authorization: "Bearer operator",
    });
    expect(fetched?.path).not.toContain("operator");
    expect(created).toStrictEqual(["blob:1"]);
    expect(container.textContent).toContain("support.json downloaded");
  });

  it("keeps a credential refusal visible after it hides Back up now, and refreshes health", async () => {
    serve((call) =>
      call.method === "POST"
        ? new Response(JSON.stringify({ error: "insufficient delivery capability" }), {
            status: 403,
          })
        : undefined,
    );
    await render();
    const healthBefore = calls.filter((call) => call.path.startsWith("healthz")).length;
    await click("Back up now");
    await click("Take a backup now");
    expect(button("Back up now")).toBeUndefined();
    expect(container.textContent).toContain("missing management capability");
    expect(calls.filter((call) => call.path.startsWith("healthz")).length).toBeGreaterThan(
      healthBefore,
    );
  });

  it("keeps an export refusal visible after it hides the Create buttons", async () => {
    serve((call) =>
      call.method === "POST"
        ? new Response(JSON.stringify({ error: "insufficient delivery capability" }), {
            status: 403,
          })
        : undefined,
    );
    await render();
    await type("Reason", "ticket 9");
    await click("Create");
    await click("Create support-bundle");
    expect(button("Create")).toBeUndefined();
    expect(container.textContent).toContain("missing management capability");
  });
});
