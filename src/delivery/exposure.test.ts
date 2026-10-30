import { describe, expect, it } from "vitest";
import type {
  AdvisoryFeedStatus,
  ChangeEvent,
  EffectiveCriticality,
  ExposureQueryResult,
} from "../api/tenkai.gen";
import {
  ageMs,
  cohortNames,
  criticalityLabel,
  exposureCsv,
  exposureQueryPath,
  exposureRows,
  feedLine,
  freshnessLabel,
  recallEvents,
  uniqueReleases,
} from "./exposure";

const NOW = Date.UTC(2026, 9, 30, 12);
const IMPORTED = Date.UTC(2026, 9, 28, 12);

const result = (overrides: Partial<ExposureQueryResult> = {}): ExposureQueryResult => ({
  component: "openssl",
  range: ">=1.0.0",
  matches: [
    {
      release: "api@1.0.0",
      product: "api",
      version: "1.0.0",
      release_id: "tenkai:release:api@1.0.0",
      component: "openssl",
      component_version: "1.1.1",
      channels: ["api/stable"],
      environments: [
        {
          environment: "hub",
          deployed_release: "api@1.0.0",
          freshness: { kind: "hub" },
          criticality: "high",
        },
        {
          environment: "spoke",
          deployed_release: "api@1.0.0",
          freshness: { kind: "as_of_last_bundle_import", imported_at: IMPORTED },
          criticality: "medium",
        },
      ],
      criticality: "high",
    },
  ],
  ...overrides,
});

describe("exposureQueryPath", () => {
  it("matches tenkaictl exposure query query-string encoding", () => {
    expect(exposureQueryPath("openssl", ">=1.0.0")).toBe(
      "v1/exposures?component=openssl&range=%3E%3D1.0.0",
    );
  });
});

describe("feedLine", () => {
  it("names last import, age, and whether a feed exists for the gate", () => {
    const missing: AdvisoryFeedStatus = {
      imported: false,
      imported_at: 0,
      generated_at: 0,
      age_ms: 0,
      advisory_count: 0,
      matches: [],
    };
    expect(feedLine(missing)).toBe("no advisory feed imported · stale-feed gate: no feed");
    const imported: AdvisoryFeedStatus = {
      imported: true,
      imported_at: IMPORTED,
      generated_at: IMPORTED,
      age_ms: NOW - IMPORTED,
      advisory_count: 2,
      matches: [],
    };
    expect(feedLine(imported)).toBe(
      `last import ${new Date(IMPORTED).toISOString()} · age ${ageMs(NOW - IMPORTED)} · stale-feed gate: feed present`,
    );
  });
});

describe("freshnessLabel", () => {
  it("labels hub and isolated-spoke observations from the query", () => {
    expect(freshnessLabel({ kind: "hub" })).toBe("live");
    expect(freshnessLabel({ kind: "as_of_last_bundle_import", imported_at: IMPORTED })).toBe(
      `as of bundle ${new Date(IMPORTED).toISOString()}`,
    );
    expect(freshnessLabel({ kind: "unknown" })).toBe("unknown");
  });
});

describe("criticalityLabel", () => {
  it("marks the level when derived is what still counts", () => {
    const derived: EffectiveCriticality = {
      derived: {
        level: "high",
        source: "envelope",
        reason: "advisory",
        generated_at: 1,
        imported_at: 1,
        age_ms: 1,
        stale: false,
      },
      effective: "high",
    };
    expect(criticalityLabel("high", derived)).toBe("high (derived)");
    expect(criticalityLabel("high", { declared: { ...declared(), level: "high" } })).toBe("high");
    expect(criticalityLabel(undefined, derived)).toBe("·");
  });
});

describe("exposureRows", () => {
  it("lists environment, release, component version, criticality and freshness", () => {
    const rows = exposureRows(result(), {
      api: {
        derived: {
          level: "high",
          source: "envelope",
          reason: "advisory",
          generated_at: 1,
          imported_at: 1,
          age_ms: 1,
          stale: false,
        },
        effective: "high",
      },
    });
    expect(rows).toEqual([
      {
        environment: "hub",
        release: "api@1.0.0",
        componentVersion: "1.1.1",
        criticality: "high (derived)",
        freshness: "live",
        product: "api",
      },
      {
        environment: "spoke",
        release: "api@1.0.0",
        componentVersion: "1.1.1",
        criticality: "medium",
        freshness: `as of bundle ${new Date(IMPORTED).toISOString()}`,
        product: "api",
      },
    ]);
  });

  it("keeps a catalog-only match so the query still shows the release", () => {
    const rows = exposureRows(
      result({
        matches: [
          {
            ...result().matches[0]!,
            environments: [],
            criticality: "low",
          },
        ],
      }),
    );
    expect(rows).toEqual([
      {
        environment: "·",
        release: "api@1.0.0",
        componentVersion: "1.1.1",
        criticality: "low",
        freshness: "·",
        product: "api",
      },
    ]);
  });
});

describe("uniqueReleases and csv", () => {
  it("recalls each catalog release once and exports the table", () => {
    expect(uniqueReleases(result())).toEqual(["api@1.0.0"]);
    expect(exposureCsv(exposureRows(result()))).toBe(
      [
        "environment,release,component_version,criticality,freshness",
        "hub,api@1.0.0,1.1.1,high,live",
        `spoke,api@1.0.0,1.1.1,medium,as of bundle ${new Date(IMPORTED).toISOString()}`,
      ].join("\n"),
    );
  });
});

describe("recallEvents and cohortNames", () => {
  it("lists recalled releases newest first and splits a CLI cohort", () => {
    const events: ChangeEvent[] = [
      { cursor: "1", occurred_at: 1, kind: "release_published", resource: "api@1.0.0" },
      { cursor: "2", occurred_at: 2, kind: "release_recalled", resource: "api@1.0.0" },
      { cursor: "3", occurred_at: 3, kind: "release_recalled", resource: "api@1.1.0" },
    ];
    expect(recallEvents(events).map((event) => event.resource)).toEqual(["api@1.1.0", "api@1.0.0"]);
    expect(cohortNames(" canary, stage,prod ")).toEqual(["canary", "stage", "prod"]);
    expect(cohortNames("")).toEqual([]);
  });
});

const declared = () => ({
  level: "low" as const,
  owner: "ops",
  reason: "lab",
  set_at: 1,
  source: "declared",
});
