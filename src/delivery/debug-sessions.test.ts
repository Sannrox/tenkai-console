import { describe, expect, it, vi } from "vitest";
import {
  countedApprovals,
  debugPolicy,
  elevationNeed,
  fetchSessions,
  instanceHistory,
  liveSession,
  offerDebug,
  parseElevationApproval,
  remainingLabel,
  sessionsPath,
} from "./debug-sessions";

const answering = (status: number, body: unknown) =>
  vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));

const SESSION = {
  id: "dbg_1",
  environment: "prod",
  instance: "api",
  subject: "raphael",
  opened_by: "raphael",
  mode: "read" as const,
  reason: "5xx after 1.18.2",
  opened_at: 1,
  not_after: 1 + 4 * 3_600_000,
  state: "open" as const,
};

const ENVELOPE = {
  schema: "tenkai.debug-elevation-approval.v1",
  key_id: "k1",
  signature: "sig",
  statement: {
    session: "dbg_1",
    elevation: "el_1",
    environment: "prod",
    purpose: "debug_elevate",
    issued_at: 1,
    expires_at: 2,
  },
};

describe("offerDebug", () => {
  it("is only a human with the debug grant", () => {
    expect(offerDebug(undefined)).toBe(false);
    expect(offerDebug(null)).toBe(false);
    expect(
      offerDebug({ principal: "a", kind: "human", capabilities: ["read", "management"] }),
    ).toBe(false);
    expect(offerDebug({ principal: "agent", kind: "agent", capabilities: ["read", "debug"] })).toBe(
      false,
    );
    expect(
      offerDebug({ principal: "m", kind: "management", capabilities: ["read", "debug"] }),
    ).toBe(false);
    expect(offerDebug({ principal: "h", kind: "human", capabilities: ["read", "debug"] })).toBe(
      true,
    );
  });
});

describe("debugPolicy", () => {
  it("forbids when the field is absent", () => {
    expect(debugPolicy(undefined)).toBe("forbid");
    expect(debugPolicy({})).toBe("forbid");
    expect(debugPolicy({ debug_sessions: "read" })).toBe("read");
    expect(debugPolicy({ debug_sessions: "elevate" })).toBe("elevate");
  });
});

describe("remainingLabel", () => {
  it("formats hours and minutes from the bound", () => {
    const now = Date.UTC(2026, 10, 26, 12, 0, 0);
    expect(remainingLabel(now + 3 * 3_600_000 + 12 * 60_000, now)).toBe("3h 12m");
    expect(remainingLabel(now + 22 * 60_000, now)).toBe("22m");
    expect(remainingLabel(now - 1_000, now)).toBe("0m");
  });
});

describe("session helpers", () => {
  it("picks the open session for one instance and keeps history", () => {
    const expired = { ...SESSION, id: "dbg_0", state: "expired" as const, instance: "api" };
    const other = { ...SESSION, id: "dbg_2", instance: "web" };
    const sessions = [SESSION, expired, other];
    expect(liveSession(sessions, "api")?.id).toBe("dbg_1");
    expect(instanceHistory(sessions, "api").map((item) => item.id)).toEqual(["dbg_1", "dbg_0"]);
  });

  it("encodes the environment query", () => {
    expect(sessionsPath("prod eu")).toBe("v1/debug-sessions?environment=prod%20eu");
  });
});

describe("fetchSessions", () => {
  it("keeps server order", async () => {
    const load = await fetchSessions(
      "prod",
      "t",
      answering(200, { sessions: [SESSION, { ...SESSION, id: "dbg_0", instance: "web" }] }),
    );
    expect(load.kind === "ok" && load.value.map((item) => item.id)).toEqual(["dbg_1", "dbg_0"]);
  });

  it("reads a missing route as unavailable and 403 as forbidden", async () => {
    expect(await fetchSessions("prod", "t", answering(404, { error: "x" }))).toEqual({
      kind: "unavailable",
    });
    expect(await fetchSessions("prod", "t", answering(403, { error: "x" }))).toEqual({
      kind: "forbidden",
    });
  });
});

describe("elevation quorum and paste", () => {
  it("does not count the requester", () => {
    expect(
      countedApprovals({
        id: "el_1",
        session: "dbg_1",
        environment: "prod",
        requested_by: "raphael",
        requester: "raphael",
        reason: "restart",
        requested_at: 1,
        duration_ms: 1,
        state: "pending",
        approvals: [
          { identity: "raphael", key_id: "k0", approved_at: 1 },
          { identity: "ops-oncall", key_id: "k1", approved_at: 2 },
        ],
      }),
    ).toBe(1);
    expect(elevationNeed({ configured: true, mode: "human" })).toBe(1);
    expect(
      elevationNeed({
        configured: true,
        mode: "human",
        quorums: [{ n: 2, purpose: "debug_elevate" }],
      }),
    ).toBe(2);
  });

  it("accepts an envelope for this elevation and refuses others", () => {
    expect(parseElevationApproval("prod", "dbg_1", "el_1", JSON.stringify(ENVELOPE))).toEqual(
      ENVELOPE,
    );
    expect(parseElevationApproval("prod", "dbg_1", "el_1", "not-json")).toMatch(/JSON file/);
    expect(parseElevationApproval("stage", "dbg_1", "el_1", JSON.stringify(ENVELOPE))).toMatch(
      /not stage/,
    );
    expect(
      parseElevationApproval(
        "prod",
        "dbg_1",
        "el_1",
        JSON.stringify({
          ...ENVELOPE,
          schema: "tenkai.approval.v1",
          statement: { ...ENVELOPE.statement, purpose: "execute_plan" },
        }),
      ),
    ).toMatch(/not a debug elevation/);
  });
});
