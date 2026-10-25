import { describe, expect, it } from "vitest";
import type {
  EnvironmentInspectReport,
  EnvironmentPlanSummary,
  EnvironmentSubscriptionView,
} from "../api/tenkai.gen";
import { attention, holdLine, isHeldFailedTarget, matrix, planSummary } from "./model";

const HOLD = { actor: "ops", held_at: 1_700_000_000_000, reason: "freeze" };

const sub = (
  product: string,
  state: string,
  deployed: string | null,
  head: string,
  channel = "stable",
): EnvironmentSubscriptionView => ({ product, state, deployed, head, channel });

const env = (
  name: string,
  subscriptions: EnvironmentSubscriptionView[],
  latest_plan: EnvironmentPlanSummary | null = null,
): EnvironmentInspectReport => ({
  name,
  id: `tenkai:env:${name}`,
  description: "",
  execution_note: "",
  facts: {},
  lease: { held: false, status: "free" },
  subscriptions,
  latest_plan,
});

const plan = (state: string, product: string, to: string, detail = ""): EnvironmentPlanSummary => ({
  id: "p-1",
  state,
  created_at: 0,
  step_count: 1,
  status_detail: detail,
  steps: [
    {
      id: "s1",
      order: 1,
      product,
      action: "upgrade",
      from: null,
      to,
      release_id: `rel-${product}-${to}`,
    },
  ],
});

describe("matrix", () => {
  const reports = [
    env("prod-eu", [
      sub("api", "behind", "1.14.2", "1.16.0"),
      sub("web", "current", "3.1.4", "3.1.4"),
    ]),
    env("edge", [
      sub("api", "current", "1.16.0", "1.16.0", "edge"),
      sub("web", "current", "3.2.0", "3.2.0", "beta"),
    ]),
  ];

  it("orders columns by name and names a channel only when the environment uses one", () => {
    const { columns, products } = matrix(reports);
    expect(columns).toEqual([
      { environment: "edge", channel: undefined },
      { environment: "prod-eu", channel: "stable" },
    ]);
    expect(products).toEqual(["api", "web"]);
  });

  it("labels cells from the server's subscription state", () => {
    const m = matrix(reports);
    expect(m.cell("api", "prod-eu")).toEqual({
      version: "1.14.2",
      tone: "warn",
      status: "behind · head 1.16.0",
      channel: "stable",
    });
    expect(m.cell("web", "edge")).toMatchObject({ tone: "ok", status: "current", channel: "beta" });
    expect(m.cell("worker", "edge")).toBeUndefined();
  });

  it("shows an active plan instead of the drift it resolves", () => {
    const m = matrix([
      env("prod-eu", [sub("api", "behind", "1.14.2", "1.16.0")], plan("running", "api", "1.16.0")),
    ]);
    expect(m.cell("api", "prod-eu")?.status).toBe("rolling out → 1.16.0");
  });

  it("marks missing and unhealthy deployments", () => {
    const m = matrix([
      env("prod-us", [
        sub("scheduler", "missing", null, "0.9.1"),
        { ...sub("web", "unhealthy", "3.3.1", "3.3.1"), error: "probe failed" },
      ]),
    ]);
    expect(m.cell("scheduler", "prod-us")).toMatchObject({
      version: "none",
      tone: "bad",
      status: "missing",
    });
    expect(m.cell("web", "prod-us")).toMatchObject({
      tone: "bad",
      status: "unhealthy · probe failed",
    });
  });

  it("shows recovery-plan progress instead of a stale retry-held instruction", () => {
    const m = matrix([
      env(
        "prod-eu",
        [
          {
            ...sub("api", "unhealthy", "1.16.0", "1.16.0"),
            error:
              "target failed; automatic retry held; create and approve an explicit plan to retry",
          },
        ],
        plan("running", "api", "1.16.0"),
      ),
    ]);
    expect(m.cell("api", "prod-eu")?.status).toBe("rolling out → 1.16.0");
  });

  it("labels a held failed target as retry held", () => {
    const m = matrix([
      env("prod-eu", [
        {
          ...sub("api", "unhealthy", "1.16.0", "1.16.0"),
          error:
            "target failed; automatic retry held; create and approve an explicit plan to retry",
        },
      ]),
    ]);
    expect(m.cell("api", "prod-eu")).toMatchObject({
      version: "1.16.0",
      tone: "bad",
      status: "target failed; automatic retry held; create and approve an explicit plan to retry",
    });
  });

  it("labels a channel hold instead of the version drift it pauses", () => {
    const m = matrix([
      env("prod-eu", [
        {
          ...sub("api", "behind", "1.14.2", "1.16.0"),
          delivery_hold: HOLD,
        },
      ]),
    ]);
    expect(m.cell("api", "prod-eu")).toMatchObject({
      version: "1.14.2",
      tone: "warn",
      status: holdLine(HOLD),
    });
  });

  it("keeps a failed deployment's tone when a channel hold is also present", () => {
    const m = matrix([
      env("prod-us", [
        {
          ...sub("web", "unhealthy", "3.3.1", "3.3.1"),
          error: "probe failed",
          delivery_hold: HOLD,
        },
      ]),
    ]);
    expect(m.cell("web", "prod-us")).toMatchObject({
      tone: "bad",
      status: `unhealthy · probe failed · ${holdLine(HOLD)}`,
    });
  });
});

describe("attention", () => {
  it("ranks problems first and gives one next action each", () => {
    const items = attention([
      env("staging", [{ ...sub("web", "unhealthy", "3.3.1", "3.3.1"), error: "probe failed" }]),
      env(
        "prod-eu",
        [sub("api", "behind", "1.14.2", "1.16.0"), sub("worker", "behind", "0.8.7", "0.9.1")],
        plan("computed", "api", "1.16.0", "awaiting signed approval"),
      ),
      env("prod-us", [
        sub("scheduler", "missing", null, "0.9.1"),
        sub("web", "current", "3.1.4", "3.1.4"),
      ]),
    ]);
    expect(items.map((item) => [item.tone, item.environment, item.product, item.next])).toEqual([
      ["bad", "prod-us", "scheduler", "Plan"],
      ["bad", "staging", "web", "Roll back"],
      ["warn", "prod-eu", undefined, "Review plan"],
      ["warn", "prod-eu", "worker", "Plan"],
    ]);
    expect(items[2]?.detail).toBe("awaiting signed approval");
  });

  it("describes a plan by its steps, not its id", () => {
    expect(planSummary(plan("computed", "api", "1.16.0"))).toBe("api none → 1.16.0");
    expect(planSummary({ ...plan("computed", "api", "1.16.0"), step_count: 3 })).toBe(
      "api none → 1.16.0 +2 more",
    );
    expect(planSummary({ ...plan("computed", "api", "1.16.0"), steps: [], step_count: 1 })).toBe(
      "1 step",
    );
    const [item] = attention([
      env("local", [sub("api", "behind", "1.0.0", "1.1.0")], plan("computed", "api", "1.1.0")),
    ]);
    expect(item?.detail).toBe("ready: api none → 1.1.0");
  });

  it("is empty when everything is current", () => {
    expect(attention([env("prod", [sub("api", "current", "1.0.0", "1.0.0")])])).toEqual([]);
  });

  it("does not offer retry when a recovery plan already covers the held failed target", () => {
    const failedHeld = {
      ...sub("api", "unhealthy", "1.16.0", "1.16.0"),
      error: "target failed; automatic retry held; create and approve an explicit plan to retry",
    };
    expect(
      attention([env("prod-eu", [failedHeld], plan("computed", "api", "1.16.0"))]).map(
        (item) => item.next,
      ),
    ).toEqual(["Review plan"]);
  });

  it("does not ask to plan or roll back a target already covered by an active plan", () => {
    expect(
      attention([
        env("prod-eu", [sub("api", "missing", null, "1.0.0")], plan("running", "api", "1.0.0")),
      ]),
    ).toEqual([]);
    expect(
      attention([
        env(
          "prod-eu",
          [{ ...sub("web", "unhealthy", "3.3.1", "3.3.1"), error: "probe failed" }],
          plan("running", "web", "3.3.1"),
        ),
      ]),
    ).toEqual([]);
  });

  it("surfaces delivery holds and held failed targets with actor, time, and reason", () => {
    expect(holdLine(HOLD)).toBe("held by ops at 2023-11-14T22:13:20.000Z: freeze");
    const channelHeld = {
      ...sub("web", "current", "3.1.4", "3.1.4"),
      delivery_hold: HOLD,
    };
    const failedHeld = {
      ...sub("api", "unhealthy", "1.16.0", "1.16.0"),
      error: "target failed; automatic retry held; create and approve an explicit plan to retry",
    };
    expect(isHeldFailedTarget(failedHeld)).toBe(true);
    const items = attention([
      { ...env("prod-eu", [channelHeld, failedHeld]), delivery_hold: HOLD },
      env("prod-us", [sub("api", "behind", "1.14.2", "1.16.0")]),
    ]);
    expect(items.map((item) => [item.tone, item.environment, item.product, item.next])).toEqual([
      ["bad", "prod-eu", "api", "Retry"],
      ["warn", "prod-eu", undefined, "Release hold"],
      ["warn", "prod-eu", "web", "Release hold"],
      ["warn", "prod-us", "api", "Plan"],
    ]);
    expect(items[1]?.detail).toBe(holdLine(HOLD));
    expect(items.find((item) => item.product === "web")?.channel).toBe("stable");
    const both = attention([
      env("prod-eu", [
        {
          ...sub("api", "unhealthy", "1.16.0", "1.16.0"),
          error:
            "target failed; automatic retry held; create and approve an explicit plan to retry",
          delivery_hold: HOLD,
        },
      ]),
    ]);
    expect(both.map((item) => item.next)).toEqual(["Retry", "Release hold"]);
  });

  it("keeps unhealthy and missing alerts while a hold pauses delivery", () => {
    const items = attention([
      {
        ...env("prod-eu", [
          { ...sub("web", "unhealthy", "3.3.1", "3.3.1"), error: "probe failed" },
          sub("worker", "missing", null, "0.9.1"),
          sub("api", "behind", "1.14.2", "1.16.0"),
        ]),
        delivery_hold: HOLD,
      },
    ]);
    expect(items.map((item) => [item.tone, item.product, item.next])).toEqual([
      ["bad", "web", "Roll back"],
      ["bad", "worker", "Plan"],
      ["warn", undefined, "Release hold"],
    ]);
  });
});
