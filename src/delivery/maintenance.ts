import type {
  EnvironmentConstraint,
  EnvironmentInspectReport,
  EnvironmentMaintenanceInspect,
  EnvironmentMaintenanceWindow,
} from "../api/tenkai.gen";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export type DetailRow = { label: string; value: string };

/** Weekday and HH:MM in the viewer's zone (or `timeZone` in tests). */
export const formatViewerInstant = (ms: number, timeZone?: string): string => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(new Date(ms));
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  const hour = parts.find((part) => part.type === "hour")?.value ?? "";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "";
  return `${weekday} ${hour}:${minute}`;
};

const duration = (minutes: number): string =>
  minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;

const weekdays = (days: number[]): string =>
  days.map((day) => DAYS[day - 1] ?? String(day)).join(",");

/** One window as identity, days, start, duration, and configured timezone. */
export const formatSchedule = (window: EnvironmentMaintenanceWindow): string =>
  `${window.identity} ${weekdays(window.weekdays)} ${window.start} ${duration(window.duration_minutes)} ${window.timezone}`;

const waitingWindow = (
  maintenance: EnvironmentMaintenanceInspect | undefined,
): EnvironmentMaintenanceWindow | undefined => {
  const next = maintenance?.next_opens_at_ms;
  if (!maintenance || next === undefined) {
    return undefined;
  }
  return maintenance.windows.find((window) => window.next_opens_at_ms === next);
};

const waitingOnWindow = (report: EnvironmentInspectReport): string | undefined => {
  const plan = report.latest_plan;
  // Product windows are absent from inspect; only name an environment window
  // when that schedule is closed. An open environment with this status is
  // waiting on a product window we cannot identify here.
  if (
    plan?.state !== "blocked" ||
    report.maintenance?.eligibility !== "closed" ||
    !(plan.status_detail ?? "").includes("maintenance window")
  ) {
    return undefined;
  }
  return waitingWindow(report.maintenance)?.identity;
};

const shortPlanId = (id: string): string => id.split(":").at(-1)?.slice(0, 8) ?? id;

/** List-column latest-plan text; names the window a blocked plan waits for. */
export const planLabel = (report: EnvironmentInspectReport): string => {
  const plan = report.latest_plan;
  if (!plan) {
    return "none";
  }
  const window = waitingOnWindow(report);
  return window ? `waiting window ${window}` : plan.state;
};

const planDetail = (report: EnvironmentInspectReport): string => {
  const plan = report.latest_plan;
  if (!plan) {
    return "none";
  }
  const window = waitingOnWindow(report);
  const id = shortPlanId(plan.id);
  return window ? `${id} waiting: window ${window}` : `${id} ${plan.state}`;
};

const windowLine = (
  maintenance: EnvironmentMaintenanceInspect | undefined,
  timeZone?: string,
): string => {
  if (!maintenance) {
    return "none";
  }
  if (maintenance.eligibility === "unrestricted") {
    return "unrestricted";
  }
  if (maintenance.eligibility === "invalid") {
    return maintenance.detail ? `invalid · ${maintenance.detail}` : "invalid";
  }
  if (maintenance.eligibility === "open" && maintenance.open_until_ms !== undefined) {
    return `open · next close ${formatViewerInstant(maintenance.open_until_ms, timeZone)}`;
  }
  if (maintenance.eligibility === "closed" && maintenance.next_opens_at_ms !== undefined) {
    return `closed · next open ${formatViewerInstant(maintenance.next_opens_at_ms, timeZone)}`;
  }
  return maintenance.eligibility;
};

const closesLine = (
  maintenance: EnvironmentMaintenanceInspect | undefined,
  timeZone?: string,
): string | undefined => {
  if (maintenance?.eligibility !== "closed" || maintenance.next_opens_at_ms === undefined) {
    return undefined;
  }
  const window = waitingWindow(maintenance);
  if (!window) {
    return undefined;
  }
  return formatViewerInstant(
    maintenance.next_opens_at_ms + window.duration_minutes * 60_000,
    timeZone,
  );
};

const constraintLine = (constraint: EnvironmentConstraint): string =>
  `${constraint.kind} ${constraint.name} = ${constraint.value}`;

/** Offset of `timeZone` from UTC at `ms`, in milliseconds. */
const zoneOffset = (ms: number, timeZone: string): number => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms));
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value);
  const local = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  );
  return local - (ms - (ms % 1000));
};

/** Calendar date and ISO weekday (1 = Mon) of `ms` in `timeZone`. */
const zoneDate = (
  ms: number,
  timeZone?: string,
): { y: number; m: number; d: number; weekday: number } => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(new Date(ms));
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(part("weekday")) + 1;
  return { y: Number(part("year")), m: Number(part("month")), d: Number(part("day")), weekday };
};

/** The instant of local wall time y-m-d hh:mm in `timeZone`. */
const zoneInstant = (
  y: number,
  m: number,
  d: number,
  hh: number,
  mm: number,
  timeZone: string,
): number => {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = guess - zoneOffset(guess, timeZone);
  // A second pass settles instants near an offset change.
  return guess - zoneOffset(first, timeZone);
};

const DAY_MS = 24 * 60 * 60_000;

/** `[start, end)` of every opening of `window` overlapping `[from, to)`. */
export const windowOpenings = (
  window: EnvironmentMaintenanceWindow,
  from: number,
  to: number,
): Array<[number, number]> => {
  const [hh = 0, mm = 0] = window.start.split(":").map(Number);
  const openings: Array<[number, number]> = [];
  // A window that opened the day before can still be open at `from`.
  for (
    let day = from - DAY_MS - window.duration_minutes * 60_000;
    day < to + DAY_MS;
    day += DAY_MS
  ) {
    const { y, m, d, weekday } = zoneDate(day, window.timezone);
    if (!window.weekdays.includes(weekday)) {
      continue;
    }
    const start = zoneInstant(y, m, d, hh, mm, window.timezone);
    const end = start + window.duration_minutes * 60_000;
    if (end > from && start < to && !openings.some(([seen]) => seen === start)) {
      openings.push([start, end]);
    }
  }
  return openings.toSorted((left, right) => left[0] - right[0]);
};

export type TimelineSlot = { open: boolean; now: boolean };

/** Seven days of maintenance windows in the viewer's zone. */
export type MaintenanceTimeline = {
  /** Four 6-hour slots per day from the viewer's midnight today. */
  slots: TimelineSlot[];
  /** Weekday labels at days 0, 2 and 4. */
  days: string[];
  rows: DetailRow[];
};

const span = (ms: number): string => {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
};

const clock = (ms: number, timeZone?: string): string =>
  new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(new Date(ms));

/** "today", "tomorrow", or the weekday of `ms` relative to `midnight`. */
const dayWord = (ms: number, midnight: number, timeZone?: string): string => {
  const offset = Math.floor((ms - midnight) / DAY_MS);
  if (offset === 0) {
    return "today";
  }
  if (offset === 1) {
    return "tomorrow";
  }
  return formatViewerInstant(ms, timeZone).split(" ")[0] ?? "";
};

/**
 * The environment-detail maintenance view (#27): a 7-day strip of when its
 * windows are open, the next opening, the plan waiting for it, and the
 * constraints on one line. `null` strip when no schedule restricts it.
 */
export const maintenanceTimeline = (
  report: EnvironmentInspectReport,
  now: number,
  timeZone?: string,
): MaintenanceTimeline | null => {
  const maintenance = report.maintenance;
  const constraints = (report.constraints ?? []).map(constraintLine).join(" · ");
  const tail: DetailRow[] = [];
  if (constraints) {
    tail.push({ label: "constraints", value: constraints });
  }
  // An invalid schedule cannot be evaluated here either (its zone may not
  // exist): the plain rows carry the server's diagnostic.
  if (
    !maintenance ||
    maintenance.eligibility === "unrestricted" ||
    maintenance.eligibility === "invalid" ||
    maintenance.windows.length === 0
  ) {
    return null;
  }
  const zone = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  // Slot boundaries are local wall times, so a day stays four local slots
  // across a daylight-saving change.
  const today = zoneDate(now, timeZone);
  const boundary = (index: number): number => {
    const day = new Date(Date.UTC(today.y, today.m - 1, today.d + Math.floor(index / 4)));
    return zoneInstant(
      day.getUTCFullYear(),
      day.getUTCMonth() + 1,
      day.getUTCDate(),
      (index % 4) * 6,
      0,
      zone,
    );
  };
  const midnight = boundary(0);
  const end = boundary(28);
  const openings = maintenance.windows
    .flatMap((window) =>
      windowOpenings(window, midnight, end).map(([open, close]) => ({ window, open, close })),
    )
    .toSorted((left, right) => left.open - right.open);
  const slots = Array.from({ length: 28 }, (_, index) => {
    const from = boundary(index);
    const to = boundary(index + 1);
    return {
      open: openings.some(({ open, close }) => open < to && close > from),
      now: now >= from && now < to,
    };
  });
  const days = [0, 8, 16].map(
    (index) => formatViewerInstant(boundary(index + 2), timeZone).split(" ")[0] ?? "",
  );
  const rows: DetailRow[] = [];
  const current = openings.find(({ open, close }) => open <= now && close > now);
  const next = openings.find(({ open }) => open > now);
  if (current) {
    rows.push({
      label: "open now",
      value: `${current.window.identity}, until ${clock(current.close, timeZone)}`,
    });
  }
  if (next) {
    rows.push({
      label: "next open",
      value: `${next.window.identity}, ${dayWord(next.open, midnight, timeZone)} ${clock(next.open, timeZone)} to ${clock(next.close, timeZone)}`,
    });
  }
  const waiting = waitingOnWindow(report);
  const plan = report.latest_plan;
  if (waiting && plan && maintenance.next_opens_at_ms !== undefined) {
    rows.push({
      label: "waiting",
      value: `${shortPlanId(plan.id)}, opens in ${span(maintenance.next_opens_at_ms - now)}`,
    });
  }
  return { slots, days, rows: [...rows, ...tail] };
};
/** Environment-detail fields: eligibility, next open/close, schedule, constraints, plan. */
export const maintenanceDetail = (
  report: EnvironmentInspectReport,
  timeZone?: string,
): DetailRow[] => {
  const maintenance = report.maintenance;
  const rows: DetailRow[] = [{ label: "window", value: windowLine(maintenance, timeZone) }];
  const closes = closesLine(maintenance, timeZone);
  if (closes) {
    rows.push({ label: "closes", value: closes });
  }
  for (const window of maintenance?.windows ?? []) {
    rows.push({ label: "schedule", value: formatSchedule(window) });
  }
  for (const constraint of report.constraints ?? []) {
    rows.push({ label: "constraint", value: constraintLine(constraint) });
  }
  rows.push({ label: "plan", value: planDetail(report) });
  return rows;
};
