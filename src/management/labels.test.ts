import { describe, expect, it } from "vitest";
import { configCall } from "./environment-config";
import { fetchLabels, labelLine, releaseLabelCall } from "./labels";

const answer = (status: number, body: unknown) => async () =>
  new Response(JSON.stringify(body), { status });

describe("labels", () => {
  it("routes environment label changes to the labels resource with the generation", () => {
    expect(
      configCall("prod", 3, " zone ", { kind: "set_label", key: "region", value: "eu" }),
    ).toStrictEqual({
      method: "PUT",
      path: "v1/environments/prod/labels",
      body: {
        version: 1,
        operation: "configure",
        environment: "prod",
        expected_generation: 3,
        reason: "zone",
        change: { kind: "set_label", key: "region", value: "eu" },
      },
    });
    expect(configCall("prod", 3, "r", { kind: "clear_label", key: "region" })).toMatchObject({
      method: "DELETE",
      path: "v1/environments/prod/labels",
    });
  });

  it("sets and clears a release label without a generation", () => {
    expect(releaseLabelCall("api@1.2.0", " tier ", " tier ", " gold ")).toStrictEqual({
      method: "PUT",
      path: "v1/releases/api/1.2.0/labels",
      body: {
        version: 1,
        operation: "release_label_set",
        key: "tier",
        value: "gold",
        reason: "tier",
      },
    });
    expect(releaseLabelCall("api@1.2.0", "done", "tier")).toStrictEqual({
      method: "DELETE",
      path: "v1/releases/api/1.2.0/labels",
      body: { version: 1, operation: "release_label_clear", key: "tier", reason: "done" },
    });
  });

  it("reads labels sorted, and names no permission, no route, and refusals", async () => {
    const ok = await fetchLabels("v1/x", "t", answer(200, { zone: "b", region: "eu" }));
    expect(ok).toStrictEqual({
      kind: "ok",
      labels: [
        ["region", "eu"],
        ["zone", "b"],
      ],
    });
    expect(labelLine(ok.kind === "ok" ? ok.labels : [])).toBe("region=eu · zone=b");
    expect(labelLine([])).toBe("none");
    expect(await fetchLabels("v1/x", "t", answer(403, { error: "no" }))).toStrictEqual({
      kind: "forbidden",
    });
    expect(await fetchLabels("v1/x", "t", answer(404, null))).toStrictEqual({
      kind: "unavailable",
    });
    expect(
      await fetchLabels("v1/x", "t", answer(404, { error: "release api@9 is not published" })),
    ).toStrictEqual({ kind: "error", message: "release api@9 is not published" });
    expect(await fetchLabels("v1/x", "t", answer(200, { zone: 1 }))).toStrictEqual({
      kind: "error",
      message: "Could not load",
    });
  });
});
