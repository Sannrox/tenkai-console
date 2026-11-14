import { describe, expect, it } from "vitest";
import type { ExposureWaiver, MatchedExposure } from "../api/tenkai.gen";
import { EXPIRING_SOON_MS, waiverClearBody, waiverSetBody, waiverState } from "./waivers";

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
