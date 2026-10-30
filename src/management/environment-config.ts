import type {
  ConnectivityClass,
  EnvironmentConfigChange,
  EnvironmentConfigRequest,
  EnvironmentMaintenanceWindow,
  RegisterEnvironmentRequest,
} from "../api/tenkai.gen";
import { windowOpenings } from "../delivery/maintenance";

/**
 * Environment registration and configuration (Sannrox/tenkai#679), as
 * `tenkaictl --target remote env add` and `env facts|constraints|maintenance`
 * send them: one change per request, with a reason and the generation the
 * caller last saw. The server validates every value and answers refusals.
 */

const VERSION = 1;

/** `POST /v1/environments`. */
export const registerBody = (
  environment: string,
  description: string,
  connectivity: ConnectivityClass | "",
  reason: string,
): RegisterEnvironmentRequest => ({
  version: VERSION,
  operation: "register",
  environment: environment.trim(),
  description: description.trim(),
  ...(connectivity ? { connectivity_class: connectivity } : {}),
  reason: reason.trim(),
});

const SEGMENT: Record<EnvironmentConfigChange["kind"], string> = {
  set_fact: "facts",
  clear_fact: "facts",
  set_constraint: "constraints",
  clear_constraint: "constraints",
  set_maintenance_window: "maintenance-windows",
  remove_maintenance_window: "maintenance-windows",
  set_webhook: "webhooks",
  clear_webhooks: "webhooks",
  set_approval_policy: "approval-policy",
  clear_approval_policy: "approval-policy",
  // Routable for completeness; the console has no editor for it yet.
  set_runner_attestation: "runner-attestation",
  clear_runner_attestation: "runner-attestation",
  set_criticality: "criticality",
  clear_criticality: "criticality",
};

const CLEARS = new Set<EnvironmentConfigChange["kind"]>([
  "clear_fact",
  "clear_constraint",
  "remove_maintenance_window",
  "clear_webhooks",
  "clear_approval_policy",
  "clear_runner_attestation",
  "clear_criticality",
]);

/** The route, method and body of one change, as the server routes it. */
export const configCall = (
  environment: string,
  generation: number,
  reason: string,
  change: EnvironmentConfigChange,
): { method: "PUT" | "DELETE"; path: string; body: EnvironmentConfigRequest } => {
  const window =
    "name" in change && SEGMENT[change.kind] === "maintenance-windows" ? change.name : undefined;
  return {
    method: CLEARS.has(change.kind) ? "DELETE" : "PUT",
    path: [
      "v1/environments",
      encodeURIComponent(environment),
      SEGMENT[change.kind],
      ...(window === undefined ? [] : [encodeURIComponent(window)]),
    ].join("/"),
    body: {
      version: VERSION,
      operation: "configure",
      environment,
      expected_generation: generation,
      reason: reason.trim(),
      change,
    },
  };
};

/** Longest maintenance window Tenkai accepts: 7 days. */
const MAX_WINDOW_MINUTES = 7 * 24 * 60;

export type WindowDraft = {
  name: string;
  timezone: string;
  /** ISO weekdays, 1 = Monday. */
  weekdays: number[];
  start: string;
  durationMinutes: number;
};

/**
 * The next opening of a draft window after `now`, scheduled as the server
 * schedules it (the same `windowOpenings` the detail view uses), or why
 * there is none to show. The server still validates the window on save.
 */
export const nextOpening = (draft: WindowDraft, now: number): number | string => {
  try {
    Intl.DateTimeFormat("en", { timeZone: draft.timezone }).format(now);
  } catch {
    return "unknown time zone";
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.start)) {
    return "start must be HH:MM";
  }
  if (
    draft.weekdays.length === 0 ||
    !draft.weekdays.every((day) => Number.isInteger(day) && day >= 1 && day <= 7)
  ) {
    return "pick weekdays";
  }
  // Also refuses NaN and Infinity, which would never end the schedule loop.
  if (!Number.isSafeInteger(draft.durationMinutes) || draft.durationMinutes <= 0) {
    return "minutes must be a whole number above 0";
  }
  // Tenkai's own bound (1..=10080); a longer one would stall the scan.
  if (draft.durationMinutes > MAX_WINDOW_MINUTES) {
    return "at most 7 days";
  }
  const window: EnvironmentMaintenanceWindow = {
    identity: draft.name,
    timezone: draft.timezone,
    weekdays: draft.weekdays,
    start: draft.start,
    duration_minutes: draft.durationMinutes,
  };
  // Two weeks covers every weekly schedule, clock changes included.
  const first = windowOpenings(window, now, now + 15 * 24 * 3_600_000).find(
    ([start]) => start > now,
  );
  return first?.[0] ?? "no opening in the next two weeks";
};
