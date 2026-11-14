import { describe, expect, it } from "vitest";
import type { ExposureWaiver, MatchedExposure } from "../api/tenkai.gen";
import {
  EXPIRING_SOON_MS,
  fetchWaivers,
  inGrace,
  waiverClearBody,
  waiverSetBody,
  waiverState,
} from "./waivers";

const NOW = Date.UTC(2026, 10, 14, 12);

const MATCH: MatchedExposure = {
  advisory_id: "TENKAI-2026-1",
  severity: "high",
  component: "openssl",
  component_version: "1.1.1",
  release: "api@1.0.0",
  release_id: "tenkai:release:api@1.0.0",
};

const waiver = (expires_at: number): ExposureWaiver => ({
  advisory_id: "TENKAI-2026-1",
  scope: "product",
  product: "api",
  category: "mitigated",
  reason: "patched upstream",
  actor: "alice",
  expires_at,
});

describe("waiverState", () => {
  it("drops an expired waiver and highlights one inside the expiring window", () => {
    expect(waiverState(undefined, NOW)).toBe("none");
    expect(waiverState(waiver(NOW), NOW)).toBe("none");
    expect(waiverState(waiver(NOW + EXPIRING_SOON_MS), NOW)).toBe("expiring");
    expect(waiverState(waiver(NOW + EXPIRING_SOON_MS + 1), NOW)).toBe("active");
  });
});

describe("waiver bodies", () => {
  it("names only the field the scope covers", () => {
    const form = { category: "false_positive", reason: " noise ", expires: "7d" } as const;
    expect(waiverSetBody(MATCH, { ...form, scope: "product" })).toEqual({
      version: 1,
      operation: "waiver_set",
      advisory_id: "TENKAI-2026-1",
      scope: "product",
      category: "false_positive",
      reason: "noise",
      expires: "7d",
      product: "api",
    });
    const global = waiverSetBody(MATCH, { ...form, scope: "global" });
    expect([global.release_id, global.product, global.component]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("clears the waiver at its own scope and target", () => {
    expect(waiverClearBody(waiver(NOW), "fixed")).toEqual({
      version: 1,
      operation: "waiver_clear",
      advisory_id: "TENKAI-2026-1",
      scope: "product",
      reason: "fixed",
      release_id: null,
      component: null,
      product: "api",
    });
  });
});

const answering = (status: number, body: unknown) => (): Promise<Response> =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe("fetchWaivers", () => {
  it("asks for expired waivers only when included, and lists soonest expiry first", async () => {
    const asked: string[] = [];
    const load = await fetchWaivers(true, "t", (input) => {
      asked.push(input instanceof URL ? input.href : JSON.stringify(input));
      return answering(200, { waivers: [waiver(NOW + 2), waiver(NOW - 1)] })();
    });
    expect(asked[0]).toMatch(/\/v1\/exposures\/waivers\?include_expired=true$/);
    expect(load).toEqual({ kind: "ok", waivers: [waiver(NOW - 1), waiver(NOW + 2)] });
    await fetchWaivers(false, "t", (input) => {
      asked.push(input instanceof URL ? input.href : JSON.stringify(input));
      return answering(200, { waivers: [] })();
    });
    expect(asked[1]).toMatch(/\/v1\/exposures\/waivers$/);
  });

  it("reads an older server, a refusal, and a malformed body without raw text", async () => {
    expect(await fetchWaivers(false, "t", answering(405, {}))).toEqual({ kind: "unavailable" });
    expect(await fetchWaivers(false, "t", answering(403, {}))).toEqual({ kind: "forbidden" });
    expect(await fetchWaivers(false, "t", answering(500, { error: "boom" }))).toEqual({
      kind: "error",
    });
    expect(await fetchWaivers(false, "t", answering(200, { waivers: [{}] }))).toEqual({
      kind: "error",
    });
  });
});

describe("inGrace", () => {
  it("keeps only the environments the server reports within grace", () => {
    const within = { environment: "prod", grace_ends_at: NOW + 1, in_grace: true };
    expect(inGrace(undefined)).toEqual([]);
    expect(
      inGrace([within, { environment: "stage", grace_ends_at: NOW - 1, in_grace: false }]),
    ).toEqual([within]);
  });
});
