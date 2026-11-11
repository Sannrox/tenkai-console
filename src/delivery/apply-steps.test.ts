import { describe, expect, it } from "vitest";
import { ApiError } from "../api/http";
import {
  APPLY_COPY,
  applyPath,
  applyRows,
  applyView,
  applyViewFromError,
  parseApplySteps,
  planStepInstance,
  stepAttempt,
  stepCut,
  stepRestored,
} from "./apply-steps";

const SUCCEEDED = {
  product: "api",
  instance: "api-a",
  action: "upgrade",
  status: "succeeded",
  to_version: "1.1.0",
  attempt_id: "dep:api:1",
};

const FAILED = {
  product: "web",
  instance: "web",
  action: "upgrade",
  status: "failed",
  to_version: "2.0.0",
  detail: "probe failed",
  detail_truncated: true,
  cause: {
    phase: "health_probe",
    kind: "probe_failed",
    summary: "probe failed",
    raw: "stderr",
  },
  restored_version: "1.0.0",
  attempt_id: "dep:web:2",
};

const PLAN = [
  { product: "api", action: "upgrade", to: "1.1.0", instance: "api-a" },
  { product: "web", action: "upgrade", to: "2.0.0", instance: "web" },
  { product: "db", action: "upgrade", to: "3.0.0" },
];

describe("parseApplySteps", () => {
  it("accepts reported steps and unknown fields", () => {
    const parsed = parseApplySteps({
      message: "applied",
      steps: [{ ...SUCCEEDED, extra: "ignored" }],
    });
    expect(parsed).toEqual([SUCCEEDED]);
  });

  it("keeps a structured cause and marks cut details", () => {
    const parsed = parseApplySteps({ steps: [{ ...FAILED, extra: "ignored" }] });
    expect(parsed?.[0]).toMatchObject({
      status: "failed",
      restored_version: "1.0.0",
      cause: {
        phase: "health_probe",
        kind: "probe_failed",
        summary: "probe failed",
        raw: "stderr",
      },
    });
    expect(stepCut(parsed![0]!)).toBe(true);
    expect(stepRestored(parsed![0]!)).toBe("1.0.0");
    expect(stepAttempt(parsed![0]!)).toBe("dep:web:2");
  });

  it("treats omitted and empty steps as absent", () => {
    expect(parseApplySteps({ message: "applied" })).toBeUndefined();
    expect(parseApplySteps({ steps: [] })).toBeUndefined();
    expect(parseApplySteps({ steps: [{ product: "api" }] })).toBeUndefined();
  });

  it("rejects a steps list that is not a complete prefix", () => {
    expect(parseApplySteps({ steps: [{ product: "nope" }, SUCCEEDED] })).toBeUndefined();
  });
});

describe("applyRows", () => {
  it("lists remaining inspect steps as not run", () => {
    const rows = applyRows([SUCCEEDED], PLAN);
    expect(rows.map((row) => [row.product, row.status, row.instance])).toEqual([
      ["api", "succeeded", "api-a"],
      ["web", "not run", "web"],
      ["db", "not run", "db"],
    ]);
  });

  it("keeps extra apply rows when inspect was truncated", () => {
    const rows = applyRows([SUCCEEDED, FAILED], PLAN.slice(0, 1));
    expect(rows).toHaveLength(2);
    expect(rows[1]?.status).toBe("failed");
  });

  it("keeps earlier planned steps as not run when only a later step is blocked", () => {
    const blocked = {
      product: "web",
      instance: "web",
      action: "upgrade",
      status: "blocked",
      to_version: "2.0.0",
    };
    const rows = applyRows([blocked], PLAN);
    expect(rows.map((row) => [row.product, row.status])).toEqual([
      ["api", "not run"],
      ["web", "blocked"],
      ["db", "not run"],
    ]);
  });
});

describe("planStepInstance", () => {
  it("uses the inspect instance when the pin omitted it", () => {
    expect(
      planStepInstance({ product: "api", action: "upgrade", to: "1", instance: "api-a" }),
    ).toBe("api-a");
    expect(planStepInstance({ product: "api", action: "upgrade", to: "1" })).toBe("api");
  });
});

describe("applyView", () => {
  it("shows the message and unavailable when the server omitted steps", () => {
    expect(applyView(true, "applied 1 step", { message: "applied 1 step" })).toEqual({
      ok: true,
      text: "applied 1 step",
      detail: "unavailable",
    });
  });

  it("merges 422 steps with remaining plan steps", () => {
    const view = applyView(false, "apply failed", { error: "apply failed", steps: [FAILED] }, PLAN);
    expect(view.ok).toBe(false);
    expect(view.rows?.map((row) => [row.product, row.status])).toEqual([
      ["api", "not run"],
      ["web", "failed"],
      ["db", "not run"],
    ]);
  });
});

describe("applyViewFromError", () => {
  it("is no access on 403", () => {
    expect(applyViewFromError(new ApiError(403, "forbidden", { error: "forbidden" }))).toEqual({
      ok: false,
      text: APPLY_COPY.forbidden,
      detail: "forbidden",
    });
  });

  it("keeps 422 steps from the error body", () => {
    const view = applyViewFromError(
      new ApiError(422, "apply failed", { error: "apply failed", steps: [FAILED] }),
      PLAN,
    );
    expect(view.rows?.map((row) => [row.product, row.status])).toEqual([
      ["api", "not run"],
      ["web", "failed"],
      ["db", "not run"],
    ]);
  });

  it("hides raw status codes", () => {
    expect(applyViewFromError(new ApiError(500, "HTTP 500"))).toEqual({
      ok: false,
      text: "Could not apply",
    });
  });
});

describe("applyPath", () => {
  it("asks for steps on the encoded plan", () => {
    expect(applyPath("tenkai:plan:1")).toBe("v1/plans/tenkai%3Aplan%3A1/apply?steps=true");
  });
});
