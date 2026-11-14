import { describe, expect, it } from "vitest";
import type { RecallView } from "../api/tenkai.gen";
import {
  fetchRecall,
  measuredShares,
  percent,
  recallActor,
  recallRange,
  recordedBeforeMeasures,
  removalByEnvironment,
  removalTotals,
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
