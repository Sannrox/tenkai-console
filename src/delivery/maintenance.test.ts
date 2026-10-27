import { describe, expect, it } from "vitest";
import type {
  EnvironmentInspectReport,
  EnvironmentMaintenanceInspect,
  EnvironmentMaintenanceWindow,
  EnvironmentPlanSummary,
} from "../api/tenkai.gen";
import {
  formatSchedule,
  formatViewerInstant,
  maintenanceDetail,
  maintenanceTimeline,
  planLabel,
  windowOpenings,
} from "./maintenance";

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

describe("maintenance timeline (#27)", () => {
  /** Thursday 2026-10-22 20:48 in Europe/Berlin; nightly opens at 02:00. */
  const NOW = Date.parse("2026-10-22T18:48:00Z");
  const nightly: EnvironmentMaintenanceWindow = {
    identity: "nightly",
    timezone: ZONE,
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    start: "02:00",
    duration_minutes: 120,
    next_opens_at_ms: Date.parse("2026-10-23T00:00:00Z"),
  };
  const blocked: EnvironmentPlanSummary = {
    id: "tenkai:plan:prod:8f21aa00",
    state: "blocked",
    status_detail: "waiting for maintenance window",
  } as EnvironmentPlanSummary;

  it("marks the open slots of the next seven days, the next opening, and the waiting plan", () => {
    const report = env(closed([nightly]), blocked, [
      { kind: "max_parallel_targets", name: "targets", value: "2" },
    ] as EnvironmentInspectReport["constraints"]);
    const timeline = maintenanceTimeline(report, NOW, ZONE);
    expect(timeline).not.toBeNull();
    const slots = timeline?.slots ?? [];
    expect(slots).toHaveLength(28);
    // 02:00 to 04:00 falls in the 00:00 to 06:00 slot of each day.
    expect(slots.map((slot) => slot.open)).toEqual(
      Array.from({ length: 28 }, (_, index) => index % 4 === 0),
    );
    expect(slots.findIndex((slot) => slot.now)).toBe(3);
    expect(timeline?.days).toEqual(["Thu", "Sat", "Mon"]);
    expect(timeline?.rows).toEqual([
      { label: "next open", value: "nightly, tomorrow 02:00 to 04:00" },
      { label: "waiting", value: "8f21aa00, opens in 5h 12m" },
      { label: "constraints", value: "max_parallel_targets targets = 2" },
    ]);
  });

  it("keeps the plain rows when no schedule restricts the environment", () => {
    expect(
      maintenanceTimeline(env({ eligibility: "unrestricted", windows: [] }), NOW, ZONE),
    ).toBeNull();
  });

  it("finds openings across a daylight-saving change", () => {
    // Europe/Berlin leaves summer time on 2026-10-25 at 03:00.
    const sunday = { ...nightly, weekdays: [7], start: "01:00", duration_minutes: 480 };
    const openings = windowOpenings(
      sunday,
      Date.parse("2026-10-24T00:00:00Z"),
      Date.parse("2026-10-26T00:00:00Z"),
    );
    expect(openings).toEqual([
      [Date.parse("2026-10-24T23:00:00Z"), Date.parse("2026-10-25T07:00:00Z")],
    ]);
  });
});

describe("maintenance timeline edge cases (#27)", () => {
  const NOW = Date.parse("2026-10-22T18:48:00Z");
  const at = (
    identity: string,
    start: string,
    weekdays: number[],
  ): EnvironmentMaintenanceWindow => ({
    identity,
    timezone: ZONE,
    weekdays,
    start,
    duration_minutes: 60,
  });

  it("names the earliest opening across windows, whatever their order", () => {
    const later = at("weekly", "03:00", [5]);
    const sooner = at("evening", "22:00", [4]);
    const timeline = maintenanceTimeline(env(closed([later, sooner])), NOW, ZONE);
    expect(timeline?.rows[0]).toEqual({
      label: "next open",
      value: "evening, today 22:00 to 23:00",
    });
  });

  it("leaves an invalid schedule to the plain rows without evaluating its zone", () => {
    const broken = { ...at("broken", "02:00", [1]), timezone: "Nowhere/Invalid" };
    expect(
      maintenanceTimeline(
        env({ eligibility: "invalid", detail: "unknown zone", windows: [broken] }),
        NOW,
        ZONE,
      ),
    ).toBeNull();
  });

  it("keeps four local slots a day across the autumn clock change", () => {
    // Monday 2026-10-26 23:30 local falls after the change on Sunday.
    const late = at("late", "23:30", [1]);
    const slots = maintenanceTimeline(env(closed([late])), NOW, ZONE)?.slots ?? [];
    // Thursday is day 0, so Monday is day 4 and its last slot is index 19.
    expect(slots.findIndex((slot) => slot.open)).toBe(19);
  });
});

describe("maintenance timeline across spring forward (#27)", () => {
  it("keeps the local date a clock change would skip, and labels it by calendar date", () => {
    // UTC viewer on Thursday 2026-03-26; Berlin springs forward on Sunday 2026-03-29.
    const now = Date.parse("2026-03-26T12:00:00Z");
    const sunday: EnvironmentMaintenanceWindow = {
      identity: "sunday",
      timezone: ZONE,
      weekdays: [7],
      start: "01:00",
      duration_minutes: 120,
    };
    const openings = windowOpenings(sunday, now, now + 7 * 24 * 60 * 60 * 1000);
    expect(openings[0]?.[0]).toBe(Date.parse("2026-03-29T00:00:00Z"));
  });

  it("names the server's next opening even beyond the strip", () => {
    const now = Date.parse("2026-10-22T18:48:00Z");
    const next = Date.parse("2026-10-29T01:00:00Z");
    const weekly: EnvironmentMaintenanceWindow = {
      identity: "weekly",
      timezone: ZONE,
      weekdays: [4],
      start: "02:00",
      duration_minutes: 60,
      next_opens_at_ms: next,
    };
    const rows = maintenanceTimeline(env(closed([weekly])), now, ZONE)?.rows ?? [];
    expect(rows[0]).toEqual({ label: "next open", value: "weekly, Thu 02:00 to 03:00" });
  });
});
