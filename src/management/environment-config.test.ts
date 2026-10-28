import { describe, expect, it } from "vitest";
import { configCall, nextOpening, registerBody } from "./environment-config";

describe("environment configuration requests", () => {
  it("registers with a trimmed reason and connectivity only when chosen", () => {
    expect(registerBody(" edge ", "site", "", " new site ")).toStrictEqual({
      version: 1,
      operation: "register",
      environment: "edge",
      description: "site",
      reason: "new site",
    });
    expect(registerBody("edge", "", "isolated", "r").connectivity_class).toBe("isolated");
  });

  it("routes each change as tenkaictl does: PUT to set, DELETE to clear, the window in the path", () => {
    expect(
      configCall("prod", 4, " inventory ", { kind: "set_fact", key: "arch", value: "arm64" }),
    ).toStrictEqual({
      method: "PUT",
      path: "v1/environments/prod/facts",
      body: {
        version: 1,
        operation: "configure",
        environment: "prod",
        expected_generation: 4,
        reason: "inventory",
        change: { kind: "set_fact", key: "arch", value: "arm64" },
      },
    });
    expect(
      configCall("prod", 0, "r", {
        kind: "clear_constraint",
        constraint: "version_pin",
        name: "app",
      }),
    ).toMatchObject({ method: "DELETE", path: "v1/environments/prod/constraints" });
    expect(
      configCall("prod", 0, "r", { kind: "remove_maintenance_window", name: "weekly" }),
    ).toMatchObject({ method: "DELETE", path: "v1/environments/prod/maintenance-windows/weekly" });
  });
});

describe("next window preview", () => {
  // Wednesday 2026-10-28 12:00 UTC.
  const now = Date.UTC(2026, 9, 28, 12);
  const draft = {
    name: "weekly",
    timezone: "UTC",
    weekdays: [4],
    start: "02:00",
    durationMinutes: 60,
  };

  it("names the next opening after now in the window's zone", () => {
    expect(nextOpening(draft, now)).toBe(Date.UTC(2026, 9, 29, 2));
    expect(nextOpening({ ...draft, timezone: "Asia/Tokyo" }, now)).toBe(Date.UTC(2026, 9, 28, 17));
  });

  it("says why there is nothing to preview instead of guessing", () => {
    expect(nextOpening({ ...draft, timezone: "Mars/Olympus" }, now)).toBe("unknown time zone");
    expect(nextOpening({ ...draft, start: "25:00" }, now)).toBe("start must be HH:MM");
    expect(nextOpening({ ...draft, weekdays: [] }, now)).toBe("pick weekdays");
    expect(nextOpening({ ...draft, weekdays: [0] }, now)).toBe("pick weekdays");
    for (const minutes of [1e9, 1e12, 10_081]) {
      expect(nextOpening({ ...draft, durationMinutes: minutes }, now)).toBe("at most 7 days");
    }
    expect(typeof nextOpening({ ...draft, durationMinutes: 10_080 }, now)).toBe("number");
    for (const minutes of [Number.NaN, Number.POSITIVE_INFINITY, 0, -5, 1.5]) {
      expect(nextOpening({ ...draft, durationMinutes: minutes }, now)).toBe(
        "minutes must be a whole number above 0",
      );
    }
  });
});
