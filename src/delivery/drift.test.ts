import { describe, expect, it } from "vitest";
import { driftStatus, fieldSummary, parseInspectDrift } from "./drift";

const HOLD = { actor: "alice", held_at: 1, reason: "soak" };

describe("fieldSummary", () => {
  it("joins cheap names and drops value-like entries", () => {
    expect(fieldSummary(["containers", "images", "env"])).toBe("containers, images, env");
    expect(fieldSummary(["env=SECRET", "token:abc", "images"])).toBe("images");
    expect(fieldSummary([])).toBe("·");
  });
});

describe("driftStatus", () => {
  it("maps the inspect statuses", () => {
    expect(driftStatus("current")).toBe("none");
    expect(driftStatus("unknown")).toBe("unavailable");
    expect(driftStatus("modified outside Tenkai")).toBe("drifted");
  });
});

describe("parseInspectDrift", () => {
  it("is unavailable when spec_drift is omitted", () => {
    expect(
      parseInspectDrift({
        subscriptions: [{ product: "api", head: "1.0.0" }],
      }),
    ).toEqual({ kind: "unavailable" });
  });

  it("is none when every instance is current", () => {
    expect(
      parseInspectDrift({
        subscriptions: [
          {
            product: "api",
            head: "1.0.0",
            spec_drift: { status: "current", objects: [] },
          },
        ],
      }),
    ).toEqual({ kind: "none" });
  });

  it("lists drifted objects with field names and a held release", () => {
    expect(
      parseInspectDrift({
        delivery_hold: HOLD,
        subscriptions: [
          {
            product: "api",
            instance: "api",
            head: "1.2.0",
            deployed: "1.1.0",
            spec_drift: {
              status: "modified outside Tenkai",
              objects: [
                {
                  kind: "Deployment",
                  name: "api",
                  status: "modified outside Tenkai",
                  fields: ["containers", "images"],
                  extra: "ignored",
                },
              ],
            },
          },
        ],
      }),
    ).toEqual({
      kind: "ok",
      rows: [
        {
          instance: "api",
          product: "api",
          release: "1.1.0",
          object: "Deployment/api",
          differs: "containers, images",
          status: "drifted",
          held: true,
        },
      ],
    });
  });

  it("keeps adapter-unknown as unavailable, not none", () => {
    expect(
      parseInspectDrift({
        subscriptions: [
          { product: "web", head: "2.0.0", deployed: "2.0.0", spec_drift: { status: "unknown" } },
        ],
      }),
    ).toEqual({
      kind: "ok",
      rows: [
        {
          instance: "web",
          product: "web",
          release: "2.0.0",
          object: "·",
          differs: "·",
          status: "unavailable",
          held: false,
        },
      ],
    });
  });

  it("attributes drift to the deployed release, not the channel head", () => {
    expect(
      parseInspectDrift({
        delivery_hold: HOLD,
        subscriptions: [
          {
            product: "api",
            head: "1.1.0",
            deployed: "1.0.0",
            spec_drift: {
              status: "modified outside Tenkai",
              objects: [
                {
                  kind: "Deployment",
                  name: "api",
                  status: "modified outside Tenkai",
                  fields: ["images"],
                },
              ],
            },
          },
        ],
      }),
    ).toEqual({
      kind: "ok",
      rows: [
        {
          instance: "api",
          product: "api",
          release: "1.0.0",
          object: "Deployment/api",
          differs: "images",
          status: "drifted",
          held: true,
        },
      ],
    });
  });

  it("keeps unobserved instances unavailable when another is current", () => {
    expect(
      parseInspectDrift({
        subscriptions: [
          { product: "api", deployed: "1.0.0", spec_drift: { status: "current", objects: [] } },
          { product: "web", deployed: "2.0.0" },
        ],
      }),
    ).toEqual({
      kind: "ok",
      rows: [
        {
          instance: "web",
          product: "web",
          release: "2.0.0",
          object: "·",
          differs: "·",
          status: "unavailable",
          held: false,
        },
      ],
    });
  });
});
