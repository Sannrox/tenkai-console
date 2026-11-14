import { describe, expect, it, vi } from "vitest";
import {
  certificatesByInstance,
  identityColumn,
  identityRows,
  identityState,
  identityView,
  statusInstance,
} from "./identity";
import { fetchStatus, parseStatus } from "./identity-status";

const NOW = 1_700_000_000;
const answering = (status: number, body: unknown) =>
  vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));

describe("statusInstance", () => {
  it("defaults unnamed rows to the product", () => {
    expect(statusInstance({ product: "api" })).toBe("api");
    expect(statusInstance({ product: "api", instance: "web-a" })).toBe("web-a");
  });
});

describe("parseStatus", () => {
  it("keeps certificate fields and drops unknown keys", () => {
    expect(
      parseStatus([
        {
          product: "api",
          instance: "api",
          channel: "stable",
          head: "1.0.0",
          extra: true,
          certificate: {
            expires_at: NOW + 3600,
            near_expiry: true,
            renewal_failure: "runtime unreachable",
            extra: 1,
          },
        },
      ]),
    ).toEqual([
      {
        product: "api",
        instance: "api",
        certificate: {
          expires_at: NOW + 3600,
          near_expiry: true,
          renewal_failure: "runtime unreachable",
        },
      },
    ]);
  });

  it("rejects a non-array body", () => {
    expect(parseStatus({ product: "api" })).toBeUndefined();
  });
});

describe("identityState", () => {
  it("is none without a certificate", () => {
    expect(identityState(undefined, NOW)).toBe("none");
    expect(identityState(null, NOW)).toBe("none");
  });

  it("prefers expired over near expiry", () => {
    expect(identityState({ expires_at: NOW - 1, near_expiry: true }, NOW)).toBe("expired");
  });

  it("is near expiry in the last sixth", () => {
    expect(identityState({ expires_at: NOW + 60, near_expiry: true }, NOW)).toBe("near expiry");
  });

  it("is renewing when the last attempt failed", () => {
    expect(
      identityState({ expires_at: NOW + 3600, near_expiry: false, renewal_failure: "busy" }, NOW),
    ).toBe("renewing");
  });

  it("is valid otherwise", () => {
    expect(identityState({ expires_at: NOW + 3600, near_expiry: false }, NOW)).toBe("valid");
  });
});

describe("identityView", () => {
  it("names the URI only when a certificate was reported", () => {
    expect(identityView("prod", "api", undefined, NOW)).toEqual({
      instance: "api",
      identity: "none",
      state: "none",
      expires: "none",
      failure: "none",
      tone: "muted",
    });
    expect(
      identityView("prod", "api", { expires_at: NOW + 3600, near_expiry: false }, NOW),
    ).toEqual({
      instance: "api",
      identity: "tenkai://prod/api",
      state: "valid",
      expires: new Date((NOW + 3600) * 1000).toISOString(),
      failure: "none",
      tone: "ok",
    });
  });
});

describe("identityRows", () => {
  it("keeps list order and appends status-only instances", () => {
    const rows = identityRows(
      "prod",
      ["api", "web"],
      [
        {
          product: "web",
          instance: "web",
          certificate: { expires_at: NOW + 10, near_expiry: true },
        },
        { product: "orphan", certificate: { expires_at: NOW + 10, near_expiry: false } },
      ],
      NOW,
    );
    expect(rows.map((row) => row.instance)).toEqual(["api", "web", "orphan"]);
    expect(rows[0]?.state).toBe("none");
    expect(rows[1]?.state).toBe("near expiry");
    expect(rows[2]?.identity).toBe("tenkai://prod/orphan");
  });
});

describe("certificatesByInstance", () => {
  it("skips rows without a certificate", () => {
    expect([
      ...certificatesByInstance([{ product: "api" }, { product: "web", certificate: null }]).keys(),
    ]).toEqual([]);
  });
});

describe("identityColumn", () => {
  it("is n/a when status is missing, forbidden, or an error", () => {
    expect(identityColumn(undefined, undefined)).toEqual({ label: "n/a", tone: "muted" });
    expect(identityColumn({ kind: "unavailable" }, undefined)).toEqual({
      label: "n/a",
      tone: "muted",
    });
    expect(identityColumn({ kind: "forbidden" }, undefined)).toEqual({
      label: "n/a",
      tone: "muted",
    });
    expect(identityColumn({ kind: "error", message: "Could not load" }, undefined)).toEqual({
      label: "n/a",
      tone: "muted",
    });
  });

  it("shows near expiry from the view", () => {
    const view = identityView("prod", "api", { expires_at: NOW + 10, near_expiry: true }, NOW);
    expect(identityColumn({ kind: "ok", value: [] }, view)).toEqual({
      label: "near expiry",
      tone: "warn",
    });
  });
});

describe("fetchStatus", () => {
  it("treats 404 as an older server", async () => {
    await expect(fetchStatus("prod", "t", answering(404, { error: "not found" }))).resolves.toEqual(
      { kind: "unavailable" },
    );
  });

  it("treats 403 as no access", async () => {
    await expect(fetchStatus("prod", "t", answering(403, { error: "forbidden" }))).resolves.toEqual(
      {
        kind: "forbidden",
      },
    );
  });

  it("returns parsed rows", async () => {
    await expect(
      fetchStatus(
        "prod",
        "t",
        answering(200, [{ product: "api", channel: "stable", head: "1", certificate: null }]),
      ),
    ).resolves.toEqual({ kind: "ok", value: [{ product: "api", certificate: null }] });
  });

  it("keeps health and checks, including a state this build does not know", async () => {
    const checks = [
      { name: "disk", state: "failing", message: "97% full" },
      { name: "queue", state: "draining" },
    ];
    await expect(
      fetchStatus(
        "prod",
        "t",
        answering(200, [
          {
            product: "api",
            channel: "stable",
            head: "1",
            health: "unhealthy",
            health_checks: checks,
          },
        ]),
      ),
    ).resolves.toEqual({
      kind: "ok",
      value: [{ product: "api", health: "unhealthy", health_checks: checks }],
    });
  });
});
