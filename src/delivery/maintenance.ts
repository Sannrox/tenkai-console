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
