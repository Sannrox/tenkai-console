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
  maintenanceRefreshAt,
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
    // 02:00 to 04:00 falls in the 00:00 to 06:00 slot of each day, except
    // Sunday 2026-10-25, when 02:00 happens twice: the server schedules no
    // opening for an ambiguous start, and neither does the strip.
    expect(slots.map((slot) => slot.open)).toEqual(
      Array.from({ length: 28 }, (_, index) => index % 4 === 0 && index !== 12),
    );
    expect(slots.findIndex((slot) => slot.now)).toBe(3);
    expect(slots[3]?.label).toBe("Thu 18:00 to 00:00, closed, now");
    expect(slots[4]?.label).toBe("Fri 00:00 to 06:00, open");
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

describe("maintenance timeline keeps the latest plan (#27)", () => {
  it("shows a plan that is not waiting for a window", () => {
    const now = Date.parse("2026-10-22T18:48:00Z");
    const nightly: EnvironmentMaintenanceWindow = {
      identity: "nightly",
      timezone: ZONE,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      start: "02:00",
      duration_minutes: 120,
    };
    const failed = { id: "tenkai:plan:prod:7a02bb00", state: "failed" } as EnvironmentPlanSummary;
    const rows = maintenanceTimeline(env(closed([nightly]), failed), now, ZONE)?.rows ?? [];
    expect(rows).toContainEqual({ label: "plan", value: "7a02bb00 failed" });
  });
});

describe("maintenance timeline freshness (#27)", () => {
  const now = Date.parse("2026-10-22T18:48:00Z");
  it("names a per-window next opening while the environment is open", () => {
    const weekly: EnvironmentMaintenanceWindow = {
      identity: "weekly",
      timezone: ZONE,
      weekdays: [4],
      start: "20:00",
      duration_minutes: 120,
      next_opens_at_ms: Date.parse("2026-10-29T19:00:00Z"),
    };
    const open: EnvironmentMaintenanceInspect = {
      eligibility: "open",
      open_until_ms: Date.parse("2026-10-22T20:00:00Z"),
      windows: [weekly],
    };
    const rows = maintenanceTimeline(env(open), now, ZONE)?.rows ?? [];
    expect(rows).toContainEqual({ label: "next open", value: "weekly, Thu 20:00 to 22:00" });
    expect(maintenanceRefreshAt(env(open))).toBe(Date.parse("2026-10-22T20:00:00Z"));
    // A boundary already past stays due until a refreshed report arrives.
    expect(maintenanceRefreshAt(env({ ...open, open_until_ms: now - 1 }))).toBe(now - 1);
  });

  it("does not count down past an announced opening", () => {
    const nightly: EnvironmentMaintenanceWindow = {
      identity: "nightly",
      timezone: ZONE,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      start: "20:00",
      duration_minutes: 120,
      next_opens_at_ms: now - 60_000,
    };
    const blocked = {
      id: "tenkai:plan:prod:8f21aa00",
      state: "blocked",
      status_detail: "waiting for maintenance window",
    } as EnvironmentPlanSummary;
    const rows = maintenanceTimeline(env(closed([nightly]), blocked), now, ZONE)?.rows ?? [];
    expect(rows).toContainEqual({ label: "waiting", value: "8f21aa00, window opening" });
  });
});

describe("maintenance openings at clock changes, as the server schedules them (#27)", () => {
  const sunday = (start: string): EnvironmentMaintenanceWindow => ({
    identity: "sunday",
    timezone: ZONE,
    weekdays: [7],
    start,
    duration_minutes: 60,
  });
  it("gives no opening for a start that does not exist", () => {
    // 2026-03-29 02:30 does not exist in Europe/Berlin.
    const from = Date.parse("2026-03-28T00:00:00Z");
    expect(windowOpenings(sunday("02:30"), from, from + 2 * 24 * 3_600_000)).toEqual([]);
  });
  it("gives no opening for a start that exists twice", () => {
    // 2026-10-25 02:30 happens twice in Europe/Berlin.
    const from = Date.parse("2026-10-24T00:00:00Z");
    expect(windowOpenings(sunday("02:30"), from, from + 2 * 24 * 3_600_000)).toEqual([]);
  });
});

describe("clock changes far from UTC (#27)", () => {
  it("finds an overlap in a UTC+13 zone", () => {
    // 2026-04-05 02:30 happens twice in Pacific/Auckland.
    const schedule: EnvironmentMaintenanceWindow = {
      identity: "sunday",
      timezone: "Pacific/Auckland",
      weekdays: [7],
      start: "02:30",
      duration_minutes: 60,
    };
    const from = Date.parse("2026-04-03T00:00:00Z");
    expect(windowOpenings(schedule, from, from + 3 * 24 * 3_600_000)).toEqual([]);
  });
  it("starts a viewer's day after a midnight gap, not before it", () => {
    // Midnight 2026-09-06 does not exist in America/Santiago; the day starts at 01:00.
    const now = Date.parse("2026-09-06T12:00:00Z");
    const schedule: EnvironmentMaintenanceWindow = {
      identity: "early",
      timezone: "America/Santiago",
      weekdays: [6],
      start: "23:30",
      duration_minutes: 20,
    };
    const slots =
      maintenanceTimeline(env(closed([schedule])), now, "America/Santiago")?.slots ?? [];
    expect(slots[0]?.label.startsWith("Sun 01:00")).toBe(true);
    expect(slots.slice(0, 4).some((slot) => slot.open)).toBe(false);
  });
});

describe("next opening after a passed announcement (#27)", () => {
  it("prefers a computed opening over a later announcement", () => {
    // Tuesday 2026-10-20 12:30 Berlin; a daily 12:00 window's announcement has passed.
    const now = Date.parse("2026-10-20T10:30:00Z");
    const weekly: EnvironmentMaintenanceWindow = {
      identity: "weekly",
      timezone: ZONE,
      weekdays: [2],
      start: "08:00",
      duration_minutes: 600,
      next_opens_at_ms: Date.parse("2026-10-27T07:00:00Z"),
    };
    const daily: EnvironmentMaintenanceWindow = {
      identity: "daily",
      timezone: ZONE,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      start: "12:00",
      duration_minutes: 60,
      next_opens_at_ms: Date.parse("2026-10-20T10:00:00Z"),
    };
    const open: EnvironmentMaintenanceInspect = { eligibility: "open", windows: [weekly, daily] };
    const rows = maintenanceTimeline(env(open), now, ZONE)?.rows ?? [];
    expect(rows).toContainEqual({ label: "next open", value: "daily, tomorrow 12:00 to 13:00" });
    expect(maintenanceRefreshAt(env(open))).toBe(Date.parse("2026-10-20T10:00:00Z"));
  });
});
