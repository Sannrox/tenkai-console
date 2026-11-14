import { describe, expect, it } from "vitest";
import type { EnvironmentPlanSummary, TargetChange } from "../api/tenkai.gen";
import { DIFF_LIMITS, capRows, countsOnly, cutValue, stepDiffs } from "./target-changes";

const plan = (...changes: TargetChange[][]): EnvironmentPlanSummary => ({
  id: "tenkai:plan:1",
  state: "computed",
  created_at: 1,
  step_count: changes.length,
  steps: changes.map((target_changes, index) => ({
    id: `s${index}`,
    order: index,
    product: "api",
    action: "upgrade",
    release_id: "rel",
    to: "1.1.0",
    target_changes,
  })),
});

const SERVICE: TargetChange = {
  kind: "Service",
  name: "api",
  live_digest: "sha256:live",
  field_count: 1,
  fields: [{ field: "ports", from: "80", to: "8080" }],
};

describe("stepDiffs", () => {
  it("drops objects whose live state already matches and steps with nothing to change", () => {
    const diffs = stepDiffs(
      plan([SERVICE, { kind: "ConfigMap", name: "cfg", live_digest: "sha256:x" }], []),
    );
    expect(diffs).toHaveLength(1);
    expect(diffs[0]?.objects.map((object) => object.name)).toEqual(["api"]);
  });

  it("never carries secret field values, only that the digest changed", () => {
    const [step] = stepDiffs(
      plan([
        {
          kind: "Secret",
          name: "creds",
          live_digest: "sha256:s",
          fields: [{ field: "data.password", from: "plain-old", to: "plain-new" }],
        },
        { kind: "SealedSecret", name: "sealed", live_digest: "sha256:t", field_count: 2 },
      ]),
    );
    expect(step?.objects.map((object) => [object.secret, object.fields, object.count])).toEqual([
      [true, undefined, 1],
      [true, undefined, 2],
    ]);
    expect(JSON.stringify(step)).not.toContain("plain-");
    expect(countsOnly(step ? [step] : [])).toBe(false);
  });

  it("marks counts without fields as needing the full diff, and new objects", () => {
    const diffs = stepDiffs(
      plan([
        { kind: "Service", name: "api", live_digest: "sha256:l", field_count: 3 },
        { kind: "File", name: "/etc/app.conf", live_digest: "absent" },
      ]),
    );
    expect(diffs[0]?.objects.map((object) => [object.count, object.created])).toEqual([
      [3, false],
      [0, true],
    ]);
    expect(countsOnly(diffs)).toBe(true);
  });

  it("skips malformed objects instead of rendering them", () => {
    const bad = { kind: "Service", name: 1, live_digest: "x", field_count: 1 } as unknown;
    expect(stepDiffs(plan([bad as TargetChange]))).toEqual([]);
  });
});

describe("caps", () => {
  it("shows at most the row cap and counts the rest", () => {
    const fields = Array.from({ length: DIFF_LIMITS.rows + 7 }, (_, index) => ({
      field: `f${index}`,
      to: "x",
    }));
    const { shown, hidden } = capRows(
      stepDiffs(plan([{ ...SERVICE, field_count: fields.length, fields }])),
    );
    expect([shown.size, hidden]).toEqual([DIFF_LIMITS.rows, 7]);
  });

  it("cuts long values", () => {
    expect(cutValue("a".repeat(DIFF_LIMITS.value + 1))).toBe(
      `${"a".repeat(DIFF_LIMITS.value)} cut`,
    );
    expect(cutValue("short")).toBe("short");
  });
});
