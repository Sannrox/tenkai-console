import { describe, expect, it } from "vitest";
import { ApiError } from "../api/http";
import type { RecallView } from "../api/tenkai.gen";
import {
  environmentRows,
  exclusionsFor,
  fetchRecall,
  fetchRecallRanges,
  measuredLine,
  measuredShares,
  parseEnvironments,
  percent,
  rangeKey,
  rangeLine,
  recallActor,
  recallRange,
  recordedBeforeMeasures,
  remainingInScope,
  removalByEnvironment,
  removalTotals,
  showsScope,
  widenBody,
  widenOutcome,
  wideningLine,
} from "./recall";

const answering =
  (status: number, body: unknown): typeof fetch =>
  () =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));

const view = (patch: Partial<RecallView>): RecallView => ({
  release: "api@1.0.0",
  covers_future: false,
  ...patch,
});

describe("fetchRecall", () => {
  it("reads the encoded release route", async () => {
    let url = "";
    const load = await fetchRecall("api@1.0.0", "t", (input) => {
      url = input instanceof URL ? input.href : JSON.stringify(input);
      return answering(200, view({}))(input);
    });
    expect(url).toMatch(/\/v1\/releases\/api%401\.0\.0\/recall$/);
    expect(load.kind).toBe("ok");
  });

  // 404 is a release with no recall; 405 is an older server with POST only.
  it("tells not recalled from an older server and hides server text", async () => {
    expect(await fetchRecall("a@1", "t", answering(404, { error: "x" }))).toEqual({
      kind: "not-recalled",
    });
    expect(await fetchRecall("a@1", "t", answering(405, { error: "x" }))).toEqual({
      kind: "unavailable",
    });
    expect(await fetchRecall("a@1", "t", answering(403, { error: "x" }))).toEqual({
      kind: "forbidden",
    });
    expect(await fetchRecall("a@1", "t", answering(200, { release: "a@1" }))).toEqual({
      kind: "error",
      message: "Could not load",
    });
  });
});

describe("recall lines", () => {
  it("names the policy and version, else the principal", () => {
    expect(
      recallActor(view({ policy_id: "channel-promotion-policy:api/stable", policy_version: "3" })),
    ).toBe("policy channel-promotion-policy:api/stable v3");
    expect(recallActor(view({ recalled_by: "oidc:alice" }))).toBe("oidc:alice");
  });

  it("marks an open range as covering future releases", () => {
    expect(recallRange(view({}))).toEqual({ text: "this release only", future: false });
    expect(recallRange(view({ range: "api [1.0.0, 1.2.0)" }))).toEqual({
      text: "api [1.0.0, 1.2.0) · closed",
      future: false,
    });
    expect(recallRange(view({ range: "api [1.0.0, ∞)", covers_future: true }))).toEqual({
      text: "api [1.0.0, ∞) · open, covers future releases",
      future: true,
    });
  });

  it("groups remaining instances per environment", () => {
    const entry = (environment: string, instance: string, remaining = true) => ({
      environment,
      instance,
      deployed: "api@1.0.0",
      remaining,
    });
    expect(
      removalByEnvironment(
        view({
          removal_progress: [
            entry("lab", "api"),
            entry("prod", "api-a"),
            entry("prod", "api-b"),
            entry("stage", "api", false),
          ],
        }),
      ),
    ).toEqual([
      { environment: "lab", instances: ["api"] },
      { environment: "prod", instances: ["api-a", "api-b"] },
    ]);
    expect(removalByEnvironment(view({}))).toEqual([]);
  });
});

const remaining = (environment: string, instance: string) => ({
  environment,
  instance,
  deployed: "api@1.0.0",
  remaining: true,
});

describe("measures and removal counts", () => {
  const policy = { policy_id: "channel-promotion-policy:api/stable", policy_version: "2" };

  it("shows the measured shares to a tenth of a percent", () => {
    expect(percent(0.051)).toBe("5.1%");
    expect(percent(1)).toBe("100%");
    expect(measuredShares(view({ ...policy, healthy_share: 0.88, failing_share: 0.12 }))).toBe(
      "healthy 88% · failing 12%",
    );
    expect(measuredShares(view({ recalled_by: "oidc:alice" }))).toBeUndefined();
  });

  // Before measures, a policy recall has counts but no shares; an older server has neither.
  it("tells a policy recall recorded before measures from an older server and a manual recall", () => {
    const counts = [{ environment: "lab", done: 0, total: 1 }];
    expect(recordedBeforeMeasures(view({ ...policy, removal_environments: counts }))).toBe(true);
    expect(recordedBeforeMeasures(view({ ...policy }))).toBe(false);
    expect(
      recordedBeforeMeasures(view({ ...policy, failing_share: 1, removal_environments: counts })),
    ).toBe(false);
    expect(recordedBeforeMeasures(view({ removal_environments: counts }))).toBe(false);
  });

  it("joins counted environments with the instances still running, and sums them", () => {
    const rows = removalByEnvironment(
      view({
        removal_environments: [
          { environment: "lab", done: 2, total: 2 },
          { environment: "prod", done: 1, total: 3 },
        ],
        removal_progress: [remaining("prod", "api-b"), remaining("prod", "api-c")],
      }),
    );
    expect(rows).toEqual([
      { environment: "lab", instances: [], counts: { done: 2, total: 2 } },
      { environment: "prod", instances: ["api-b", "api-c"], counts: { done: 1, total: 3 } },
    ]);
    expect(removalTotals(rows)).toEqual({ done: 3, total: 5 });
    expect(
      removalTotals(removalByEnvironment(view({ removal_progress: [remaining("a", "b")] }))),
    ).toBeUndefined();
  });
});

describe("limited removal and widen", () => {
  it("marks keep only when the recall named a scope list", () => {
    const limited = environmentRows(
      view({
        removal_scope: ["lab", "stage"],
        removal_environments: [
          { environment: "lab", done: 1, total: 2 },
          { environment: "stage", done: 0, total: 1 },
        ],
        removal_progress: [
          remaining("lab", "api-b"),
          remaining("stage", "api"),
          remaining("prod", "api-a"),
        ],
        out_of_scope: [{ environment: "prod", status: "REMOVAL_NOT_IN_SCOPE" }],
      }),
    );
    expect(limited.map((row) => [row.environment, row.scope, row.instances])).toEqual([
      ["lab", "remove", ["api-b"]],
      ["stage", "remove", ["api"]],
      ["prod", "keep", ["api-a"]],
    ]);
    expect(showsScope(limited)).toBe(true);
    expect(remainingInScope(limited).map((row) => row.environment)).toEqual(["lab", "stage"]);
    const fleet = environmentRows(
      view({
        removal_environments: [{ environment: "lab", done: 1, total: 1 }],
      }),
    );
    expect(fleet[0]?.scope).toBeUndefined();
    expect(showsScope(fleet)).toBe(false);
  });

  it("joins the fired threshold onto the measured shares", () => {
    expect(
      measuredLine(view({ healthy_share: 0.91, failing_share: 0.09, failing_max_instances: 3 })),
    ).toBe("healthy 91% · failing 9% · threshold 3 instances, reached");
    expect(measuredLine(view({ failing_share: 0.12, failing_max_share: 0.05 }))).toBe(
      "failing 12% · failing > 5%, exceeded",
    );
  });

  it("shows exclusions as values on the matching range", () => {
    const ranges = [
      {
        product: "api",
        from: "1.0.0",
        before: "1.3.0",
        covers_future: false,
        actor: "oidc:alice",
        reason: "defect",
        recorded_at: 1,
        exclusions: [
          { version: "1.1.0", actor: "oidc:alice", reason: "canary still needed", recorded_at: 2 },
        ],
      },
    ];
    const recalled = view({ range: "api [1.0.0, 1.3.0)", covers_future: false });
    expect(rangeKey(ranges[0]!)).toBe("api [1.0.0, 1.3.0)");
    expect(exclusionsFor(recalled, ranges)).toEqual(ranges[0]!.exclusions);
    expect(rangeLine(recalled, exclusionsFor(recalled, ranges))).toBe(
      "Range api [1.0.0, 1.3.0) · closed, excluding 1.1.0 by oidc:alice (canary still needed)",
    );
    expect(exclusionsFor(view({}), ranges)).toEqual([]);
  });

  it("names appended environments or covering the fleet", () => {
    expect(
      wideningLine({
        fleet_wide: false,
        environments: ["prod"],
        principal_kind: "human",
        reason: "lab canary done",
        widened_at: Date.UTC(2026, 10, 22, 16, 2),
        widened_by: "oidc:alice",
      }),
    ).toBe("2026-11-22T16:02Z oidc:alice added prod · lab canary done");
    expect(
      wideningLine({
        fleet_wide: true,
        principal_kind: "human",
        reason: "roll remaining",
        widened_at: Date.UTC(2026, 10, 22, 16, 2),
        widened_by: "oidc:alice",
      }),
    ).toBe("2026-11-22T16:02Z oidc:alice covered the fleet · roll remaining");
  });

  it("sends recall as the widen operation, never both fleet and environments", () => {
    expect(parseEnvironments(" prod, lab  stage ")).toEqual(["prod", "lab", "stage"]);
    expect(widenBody({ reason: "lab canary done", environments: ["prod"] })).toEqual({
      version: 1,
      operation: "recall",
      reason: "lab canary done",
      environments: ["prod"],
    });
    expect(widenBody({ reason: "roll remaining", fleetWide: true })).toEqual({
      version: 1,
      operation: "recall",
      reason: "roll remaining",
      fleet_wide: true,
    });
  });

  it("reads a lost widen as unknown and 405 as a refusal", () => {
    expect(widenOutcome(undefined).text).toBe("Removal widened and audited.");
    expect(widenOutcome(new TypeError("network"))).toEqual({
      tone: "unknown",
      text: "No answer from the server; the outcome is unknown until the next read.",
    });
    expect(widenOutcome(new ApiError(502, "HTTP 502")).tone).toBe("unknown");
    expect(widenOutcome(new ApiError(405, "method"))).toEqual({
      tone: "bad",
      text: "This server cannot widen removal.",
    });
    expect(widenOutcome(new ApiError(403, "secret"))).toEqual({
      tone: "bad",
      text: "Not permitted.",
    });
    expect(widenOutcome(new ApiError(400, "secret")).text).toBe("Widen refused.");
  });

  it("omits exclusions when recall-ranges is missing or unreadable", async () => {
    expect(await fetchRecallRanges("api", "t", answering(405, { error: "method" }))).toEqual([]);
    expect(await fetchRecallRanges("api", "t", answering(403, { error: "x" }))).toEqual([]);
    expect(await fetchRecallRanges("api", "t", answering(200, { items: "nope" }))).toEqual([]);
  });
});
