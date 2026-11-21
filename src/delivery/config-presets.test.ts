import { describe, expect, it } from "vitest";
import { hasConflicts, inspectPresets, parseConfigPresets, parseConflict } from "./config-presets";

const plan = (config_presets: unknown) => ({ config_presets });

describe("parseConflict", () => {
  it("reads the overlay key from a plan conflict line", () => {
    expect(parseConflict("replicas: override 3 hides preset large change 5 -> 8")).toEqual({
      key: "replicas",
      text: "replicas: override 3 hides preset large change 5 -> 8",
    });
  });

  it("keeps an unmatched line under the text before the first colon", () => {
    expect(parseConflict("region: not declared by the release")).toEqual({
      key: "region",
      text: "region: not declared by the release",
    });
  });

  it("drops a blank line", () => {
    expect(parseConflict("  ")).toBeUndefined();
  });
});

describe("parseConfigPresets", () => {
  it("reads as empty when the plan has no presets or a malformed list", () => {
    expect(parseConfigPresets(undefined)).toEqual([]);
    expect(parseConfigPresets({})).toEqual([]);
    expect(parseConfigPresets(plan("nope"))).toEqual([]);
  });

  it("drops a malformed row and keeps the rest", () => {
    expect(
      parseConfigPresets(
        plan([
          {
            product: "api",
            preset: "large",
            from_preset: ["region"],
            overridden: ["replicas"],
            conflicts: ["replicas: override 3 hides preset large change 5 -> 8"],
          },
          { product: "web" },
        ]),
      ),
    ).toEqual([
      {
        product: "api",
        preset: "large",
        fromPreset: ["region"],
        overridden: ["replicas"],
        conflicts: [
          {
            key: "replicas",
            text: "replicas: override 3 hides preset large change 5 -> 8",
          },
        ],
      },
    ]);
  });

  it("sorts products and unique keys", () => {
    expect(
      parseConfigPresets(
        plan([
          { product: "web", preset: "small", from_preset: ["size", "size", ""] },
          { product: "api", preset: "large" },
        ]),
      ),
    ).toEqual([
      {
        product: "api",
        preset: "large",
        fromPreset: [],
        overridden: [],
        conflicts: [],
      },
      {
        product: "web",
        preset: "small",
        fromPreset: ["size"],
        overridden: [],
        conflicts: [],
      },
    ]);
  });
});

describe("inspectPresets", () => {
  it("reads the latest plan on an inspect body", () => {
    expect(
      inspectPresets({
        latest_plan: plan([{ product: "api", preset: "large" }]),
      }),
    ).toEqual([
      {
        product: "api",
        preset: "large",
        fromPreset: [],
        overridden: [],
        conflicts: [],
      },
    ]);
    expect(inspectPresets({ name: "prod" })).toEqual([]);
  });
});

describe("hasConflicts", () => {
  it("is true when any product hid a preset change", () => {
    expect(hasConflicts([])).toBe(false);
    expect(
      hasConflicts([
        {
          product: "api",
          preset: "large",
          fromPreset: ["region"],
          overridden: ["replicas"],
          conflicts: [
            {
              key: "replicas",
              text: "replicas: override 3 hides preset large change 5 -> 8",
            },
          ],
        },
      ]),
    ).toBe(true);
  });
});
