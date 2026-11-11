import { describe, expect, it } from "vitest";
import {
  overlayRefusal,
  overlayRows,
  parseInspectConfig,
  refusalSchema,
  schemaHeads,
  withRefusal,
} from "./config-schema";

const REPORT = {
  subscriptions: [{ product: "api", head: "2.0.0", channel: "stable" }],
  config: [
    {
      product: "api",
      digest: "sha256:cfg",
      overlay: { region: "eu" },
      defaults: { replicas: "1" },
      secrets: ["db-password"],
      extra: "ignored",
    },
  ],
};

describe("parseInspectConfig", () => {
  it("accepts recorded product rows and unknown fields", () => {
    expect(parseInspectConfig(REPORT)).toEqual([
      {
        product: "api",
        digest: "sha256:cfg",
        overlay: { region: "eu" },
        defaults: { replicas: "1" },
        secrets: ["db-password"],
        extra: "ignored",
      },
    ]);
  });

  it("drops a malformed row and keeps the rest", () => {
    expect(
      parseInspectConfig({
        config: [{ product: "api", overlay: { region: "eu" } }, { overlay: { x: 1 } }],
      }),
    ).toEqual([{ product: "api", overlay: { region: "eu" } }]);
  });

  it("is empty when the field is missing", () => {
    expect(parseInspectConfig({ name: "prod" })).toEqual([]);
  });
});

describe("overlayRows", () => {
  it("marks overlay and default keys checked and secrets declared", () => {
    const heads = schemaHeads(REPORT);
    expect(overlayRows(parseInspectConfig(REPORT), heads)).toEqual([
      {
        product: "api",
        key: "region",
        value: "eu",
        source: "overlay",
        check: "checked",
        schema: "2.0.0",
      },
      {
        product: "api",
        key: "replicas",
        value: "1",
        source: "default",
        check: "checked",
        schema: "2.0.0",
      },
      {
        product: "api",
        key: "db-password",
        value: "",
        source: "secret",
        check: "declared",
        schema: "2.0.0",
      },
    ]);
  });

  it("does not treat overlay-only products as schema-checked", () => {
    const rows = overlayRows(
      [{ product: "api", overlay: { colour: "blue" } }],
      new Map([["api", "1.0.0"]]),
    );
    expect(rows).toEqual([
      {
        product: "api",
        key: "colour",
        value: "blue",
        source: "overlay",
        check: "declared",
        schema: "1.0.0",
      },
    ]);
  });
});

describe("overlayRefusal", () => {
  it.each([
    ["overlay colour is not declared by the release config schema", "colour", "not declared"],
    ["overlay replicas must be an integer", "replicas", "must be an integer"],
    ["overlay enabled must be true or false", "enabled", "must be true or false"],
    ["overlay region is not an allowed value", "region", "not an allowed value"],
    ["overlay replicas is required by the release config schema", "replicas", "required"],
    [
      "overlay db-password is a declared secret name; secret values are not overlays",
      "db-password",
      "secret name",
    ],
    [
      "plan local: overlay replicas is required by the release config schema",
      "replicas",
      "required",
    ],
  ] as const)("parses %s", (message, key, reason) => {
    expect(overlayRefusal(message)).toEqual({ key, reason });
  });

  it("ignores unrelated refusals", () => {
    expect(overlayRefusal("environment prod is held")).toBeUndefined();
  });
});

describe("withRefusal", () => {
  it("adds a missing required key and names the subscribed head", () => {
    const report = {
      subscriptions: [{ product: "api", head: "2.0.0" }],
      config: [{ product: "api", overlay: { region: "eu" }, secrets: ["db-password"] }],
    };
    const config = parseInspectConfig(report);
    const heads = schemaHeads(report);
    const refusal = overlayRefusal("overlay replicas is required by the release config schema");
    expect(refusal).toEqual({ key: "replicas", reason: "required" });
    const rows = withRefusal(overlayRows(config, heads), refusal, config, heads);
    expect(rows.find((row) => row.key === "replicas")).toMatchObject({
      product: "api",
      check: "required",
      schema: "2.0.0",
    });
    expect(refusal && refusalSchema(refusal, config, heads)).toBe("2.0.0");
  });
});
