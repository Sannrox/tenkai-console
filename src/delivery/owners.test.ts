import { describe, expect, it, vi } from "vitest";
import { configCall } from "../management/environment-config";
import {
  deliveryRows,
  fetchDeliveries,
  fetchProductRouting,
  setOwnerBody,
  statusOwners,
  unrouted,
} from "./owners";

const answering = (status: number, body: unknown) =>
  vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));

const RETRYING = {
  id: "d1",
  event: "apply.failed",
  url: "https://hooks.example.test/a",
  state: "retrying",
  attempts: 3,
  next_attempt_at: 1_700_000_000_000,
  last_error: "connection refused",
};

describe("fetchDeliveries", () => {
  it("reads tenant mode and older servers as unavailable, 403 as no access, never raw text", async () => {
    const refused = { error: "remote catalog lifecycle is not available in tenant mode" };
    expect(await fetchDeliveries("prod", "t", answering(503, refused))).toStrictEqual({
      kind: "unavailable",
    });
    expect(await fetchDeliveries("prod", "t", answering(404, {}))).toStrictEqual({
      kind: "unavailable",
    });
    expect(await fetchDeliveries("prod", "t", answering(403, {}))).toStrictEqual({
      kind: "forbidden",
    });
    expect(await fetchDeliveries("prod", "t", answering(500, refused))).toStrictEqual({
      kind: "error",
      message: "Could not load",
    });
  });

  it("keeps a state it does not know", async () => {
    const unconfigured = {
      id: "o",
      event: "owner.unconfigured",
      url: "",
      state: "unconfigured",
      attempts: 0,
      next_attempt_at: 0,
      last_error: "owner ops has no notification endpoint",
    };
    const load = await fetchDeliveries("prod", "t", answering(200, [unconfigured]));
    const rows = load.kind === "ok" ? deliveryRows(load.value) : [];
    expect(rows).toStrictEqual([
      {
        id: "o",
        url: "none",
        event: "owner.unconfigured",
        state: "unconfigured",
        tone: "muted",
        attempts: 0,
        next: "·",
        error: "owner ops has no notification endpoint",
      },
    ]);
  });
});

describe("deliveryRows", () => {
  it("shows the next attempt only while one is due", () => {
    const rows = deliveryRows([
      RETRYING,
      { ...RETRYING, id: "d2", state: "delivered", attempts: 1, delivered_at: 1, last_error: "" },
    ]);
    expect(rows.map((row) => [row.state, row.tone, row.next])).toStrictEqual([
      ["retrying", "warn", "2023-11-14T22:13:20.000Z"],
      ["delivered", "ok", "·"],
    ]);
  });
});

describe("unrouted", () => {
  it("flags only an environment with neither owner nor webhooks", () => {
    expect(unrouted({})).toBe(true);
    expect(unrouted({ webhooks: [] })).toBe(true);
    expect(unrouted({ owner: { contact: "ops" } })).toBe(false);
    expect(unrouted({ webhooks: [{ url: "https://h.test", secret_env: "S" }] })).toBe(false);
  });
});

describe("owner writes", () => {
  it("routes environment owner changes with a reason and generation", () => {
    expect(
      configCall("prod", 3, " handover ", { kind: "set_owner", contact: "ops" }),
    ).toStrictEqual({
      method: "PUT",
      path: "v1/environments/prod/owner",
      body: {
        version: 1,
        operation: "configure",
        environment: "prod",
        expected_generation: 3,
        reason: "handover",
        change: { kind: "set_owner", contact: "ops" },
      },
    });
    expect(configCall("prod", 3, "r", { kind: "clear_owner" })).toMatchObject({
      method: "DELETE",
      path: "v1/environments/prod/owner",
    });
  });

  it("sends a product owner as a trimmed contact", () => {
    expect(setOwnerBody(" ops@example.test ")).toStrictEqual({ contact: "ops@example.test" });
  });
});

describe("product routing and status owners", () => {
  it("reads an unset product owner as null", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async (input) =>
        new Response(
          JSON.stringify(
            (input instanceof URL ? input.pathname : "").endsWith("/owner") ? null : [],
          ),
          {
            status: 200,
          },
        ),
    );
    expect(await fetchProductRouting("api", "t", fetcher)).toStrictEqual({
      kind: "ok",
      value: { owner: null, webhooks: [] },
    });
  });

  it("names each instance's product owner, none when unset", () => {
    expect(
      statusOwners([
        { product: "api", owner: "ops" },
        { product: "web", instance: "web-eu" },
      ]),
    ).toStrictEqual([
      { instance: "api", owner: "ops" },
      { instance: "web-eu", owner: "none" },
    ]);
  });
});
