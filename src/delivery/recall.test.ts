import { describe, expect, it } from "vitest";
import type { RecallView } from "../api/tenkai.gen";
import { fetchRecall, recallActor, recallRange, removalByEnvironment } from "./recall";

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
