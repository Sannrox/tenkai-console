import { describe, expect, it } from "vitest";
import type {
  EnvironmentInspectReport,
  EnvironmentMaintenanceInspect,
  EnvironmentMaintenanceWindow,
  EnvironmentPlanSummary,
} from "../api/tenkai.gen";
import { formatSchedule, formatViewerInstant, maintenanceDetail, planLabel } from "./maintenance";

const ZONE = "Europe/Berlin";
/** Saturday 2026-10-17 22:00 in Europe/Berlin (CEST). */
const SAT_OPEN = Date.parse("2026-10-17T20:00:00Z");
const SUN_CLOSE = SAT_OPEN + 8 * 60 * 60 * 1000;

const window = (identity = "weeknights", next = SAT_OPEN): EnvironmentMaintenanceWindow => ({
  identity,
  timezone: ZONE,
  weekdays: [6, 7],
  start: "22:00",
  duration_minutes: 480,
  next_opens_at_ms: next,
});

const closed = (windows: EnvironmentMaintenanceWindow[]): EnvironmentMaintenanceInspect => {
  const next = windows[0]?.next_opens_at_ms;
  return {
    eligibility: "closed",
    ...(next === undefined ? {} : { next_opens_at_ms: next }),
    windows,
  };
};

const env = (
  maintenance?: EnvironmentMaintenanceInspect,
  latest_plan: EnvironmentPlanSummary | null = null,
  constraints: EnvironmentInspectReport["constraints"] = [],
): EnvironmentInspectReport => ({
  name: "prod",
  id: "tenkai:env:prod",
  description: "delivery cluster",
  execution_note: "",
  facts: {},
  lease: { held: true, generation: 14, status: "held" },
  subscriptions: [],
  latest_plan,
  ...(maintenance ? { maintenance } : {}),
  ...(constraints?.length ? { constraints } : {}),
});

const plan = (state: string, detail = "", id = "tenkai:plan:pln-22"): EnvironmentPlanSummary => ({
  id,
  state,
  created_at: 0,
  step_count: 1,
  status_detail: detail,
});

describe("viewer instants", () => {
  it("formats weekday and HH:MM in the given zone", () => {
    expect(formatViewerInstant(SAT_OPEN, ZONE)).toBe("Sat 22:00");
    expect(formatViewerInstant(SUN_CLOSE, ZONE)).toBe("Sun 06:00");
  });
});

describe("schedule", () => {
  it("joins identity, days, start, duration, and timezone", () => {
    expect(formatSchedule(window())).toBe("weeknights Sat,Sun 22:00 8h Europe/Berlin");
  });
});

describe("maintenance detail", () => {
  it("lists closed eligibility, next open/close, schedule, constraints, and waiting plan", () => {
    const report = env(
      closed([window()]),
      plan("blocked", "blocked outside the configured maintenance window"),
      [{ kind: "version_pin", name: "tenkai", value: "0.6.x" }],
    );
    expect(planLabel(report)).toBe("waiting window weeknights");
    expect(maintenanceDetail(report, ZONE)).toEqual([
      { label: "window", value: "closed · next open Sat 22:00" },
      { label: "closes", value: "Sun 06:00" },
      { label: "schedule", value: "weeknights Sat,Sun 22:00 8h Europe/Berlin" },
      { label: "constraint", value: "version_pin tenkai = 0.6.x" },
      { label: "plan", value: "pln-22 waiting: window weeknights" },
    ]);
  });

  it("names the window whose next opening matches inspect", () => {
    const weeknights = window("weeknights", SAT_OPEN);
    const weekdays = window("weekdays", SAT_OPEN + 86_400_000);
    const report = env(
      {
        eligibility: "closed",
        next_opens_at_ms: SAT_OPEN,
        windows: [weekdays, weeknights],
      },
      plan("blocked", "blocked outside the configured maintenance window"),
    );
    expect(planLabel(report)).toBe("waiting window weeknights");
  });

  it("leaves a non-maintenance block as the server state", () => {
    const report = env(closed([window()]), plan("blocked", "blocked by Tenkai approval"));
    expect(planLabel(report)).toBe("blocked");
    expect(maintenanceDetail(report, ZONE).at(-1)).toEqual({
      label: "plan",
      value: "pln-22 blocked",
    });
  });

  it("does not name an open environment window for a product-window block", () => {
    const report = env(
      { eligibility: "open", open_until_ms: SUN_CLOSE, windows: [window()] },
      plan("blocked", "blocked outside the configured maintenance window"),
    );
    expect(planLabel(report)).toBe("blocked");
  });

  it("omits schedule and closes when unrestricted", () => {
    const report = env({ eligibility: "unrestricted", windows: [] }, plan("applied"));
    expect(planLabel(report)).toBe("applied");
    expect(maintenanceDetail(report, ZONE)).toEqual([
      { label: "window", value: "unrestricted" },
      { label: "plan", value: "pln-22 applied" },
    ]);
  });

  it("shows an open window's close in the viewer's zone", () => {
    const report = env({
      eligibility: "open",
      open_until_ms: SUN_CLOSE,
      windows: [window()],
    });
    expect(maintenanceDetail(report, ZONE)[0]).toEqual({
      label: "window",
      value: "open · next close Sun 06:00",
    });
  });
});
