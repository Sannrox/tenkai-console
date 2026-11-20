import { describe, expect, it } from "vitest";
import { ApiError } from "../api/http";
import type { EnvironmentPlanSummary } from "../api/tenkai.gen";
import {
  COPY,
  adoptGate,
  adoptOutcome,
  adoptRelease,
  differenceFields,
  offerAdopt,
  pendingAdopt,
  recordedAdopt,
  showAdopt,
  unmanagedWorkloads,
  withoutUnmanaged,
} from "./adopt";
import type { StatusRow } from "./identity";

const plan = (state: string, action: string): EnvironmentPlanSummary => ({
  id: "tenkai:plan:1",
  state,
  created_at: 1,
  step_count: 1,
  digest: "sha256:abc",
  steps: [
    {
      id: "s1",
      order: 1,
      product: "api",
      action,
      release_id: "api@1.0.0",
      to: "1.0.0",
    },
  ],
});

describe("unmanagedWorkloads", () => {
  it("keeps only rows the server marked unmanaged", () => {
    const rows: StatusRow[] = [
      { product: "web", health: "healthy" },
      { product: "api", unmanaged: { kind: "helm", name: "api" } },
      { product: "orphan", unmanaged: { kind: "kubernetes", name: "orphan" } },
    ];
    expect(unmanagedWorkloads(rows)).toEqual([
      { kind: "helm", name: "api" },
      { kind: "kubernetes", name: "orphan" },
    ]);
    expect(
      withoutUnmanaged(
        [
          { product: "web", channel: "stable", head: "2.0.0", state: "current" },
          { product: "api", channel: "stable", head: "1.0.0", state: "missing" },
        ],
        unmanagedWorkloads(rows),
      ).map((subscription) => subscription.product),
    ).toEqual(["web"]);
  });
});

describe("adoptRelease", () => {
  it("accepts a catalog pin and rejects incomplete text", () => {
    expect(adoptRelease(" api@1.0.0 ")).toBe("api@1.0.0");
    expect(adoptRelease("api")).toBeUndefined();
    expect(adoptRelease("@1.0.0")).toBeUndefined();
    expect(adoptRelease("api@")).toBeUndefined();
    expect(adoptRelease("api 1.0.0")).toBeUndefined();
  });
});

describe("pendingAdopt", () => {
  it("treats an adopt step on an active plan as pending, and a succeeded one as recorded", () => {
    expect(pendingAdopt(plan("computed", "adopt"))).toBe(true);
    expect(pendingAdopt(plan("computed", "upgrade"))).toBe(false);
    expect(pendingAdopt(plan("succeeded", "adopt"))).toBe(false);
    expect(recordedAdopt(plan("succeeded", "adopt"))).toBe(true);
    expect(recordedAdopt(plan("computed", "adopt"))).toBe(false);
  });
});

describe("adoptGate", () => {
  it("maps named refusals and credential errors, never the server's text", () => {
    expect(adoptGate(new TypeError("network"))).toBe("unknown");
    expect(adoptGate(new ApiError(503, "store.rs:42"))).toBe("unknown");
    expect(adoptGate(new ApiError(403, "insufficient delivery capability"))).toBe("forbidden");
    expect(adoptGate(new ApiError(405, "method not allowed"))).toBe("unavailable");
    expect(
      adoptGate(
        new ApiError(
          409,
          "adopt refused: live differs from api@1.0.0 (Service/api ports, Deployment/api image)",
        ),
      ),
    ).toBe("differs");
    expect(
      differenceFields(
        new ApiError(
          409,
          "adopt refused: live differs from api@1.0.0 (Service/api ports, Deployment/api image)",
        ),
      ),
    ).toEqual(["Service/api ports", "Deployment/api image"]);
    expect(
      adoptGate(new ApiError(409, "api in prod is already recorded as deployed at 1.0.0")),
    ).toBe("already");
    expect(adoptGate(new ApiError(409, "cannot adopt recalled release api@1.0.0"))).toBe(
      "recalled",
    );
    expect(adoptGate(new ApiError(409, "api is not subscribed in prod"))).toBe("missing");
    expect(adoptGate(new ApiError(409, "expected generation 2"))).toBe("refused");
  });

  it("uses fixed copy for each gate", () => {
    expect(adoptOutcome(undefined)).toEqual({ tone: "ok", text: COPY.pending });
    expect(
      adoptOutcome(
        new ApiError(409, "adopt refused: live differs from api@1.0.0 (Service/api ports)"),
      ).text,
    ).toBe(COPY.differs);
    expect(adoptOutcome(new TypeError("network"))).toEqual({
      tone: "unknown",
      text: COPY.unknown,
    });
  });
});

describe("offerAdopt", () => {
  it("shows the form without a pin, and arms Adopt only for a chosen pin", () => {
    const open = {
      candidates: 1,
      permitted: true,
      release: "api@1.0.0",
      pending: false,
      gate: undefined,
    };
    expect(showAdopt(open)).toBe(true);
    expect(offerAdopt(open)).toBe(true);
    expect(offerAdopt({ ...open, release: undefined })).toBe(false);
    expect(showAdopt(open)).toBe(true);
    expect(offerAdopt({ ...open, candidates: 0 })).toBe(false);
    expect(offerAdopt({ ...open, permitted: false })).toBe(false);
    expect(offerAdopt({ ...open, pending: true })).toBe(false);
    expect(showAdopt({ candidates: 1, permitted: true, pending: false, gate: "differs" })).toBe(
      true,
    );
    expect(offerAdopt({ ...open, gate: "differs" })).toBe(false);
    expect(offerAdopt({ ...open, gate: "forbidden" })).toBe(false);
    expect(offerAdopt({ ...open, gate: "already" })).toBe(false);
    expect(offerAdopt({ ...open, gate: "refused" })).toBe(true);
  });
});
