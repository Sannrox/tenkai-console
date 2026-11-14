import type { DeliveryHold, FailureThreshold, HoldAuditEvent } from "../api/tenkai.gen";

// Automatic environment holds (Sannrox/tenkai#1059). A declared failure
// threshold lets the reconciler set the one environment hold with the
// reserved actor `automatic`; its reason names the failed instances and their
// causes. It lifts itself once the in-window count is at or below the
// threshold, and only while a threshold is declared. An operator hold
// replaces it and never lifts itself; the automatic hold never replaces an
// operator hold. The audit trail keeps both actors.

/** Actor Tenkai reserves for holds set by a failure threshold. */
const AUTOMATIC_ACTOR = "automatic";

/** Milliseconds in the largest unit `tenkaictl env hold threshold --window` accepts. */
export const windowLabel = (ms: number): string => {
  for (const [unit, size] of [
    ["h", 3_600_000],
    ["m", 60_000],
    ["s", 1_000],
  ] as const) {
    if (ms >= size && ms % size === 0) {
      return `${ms / size}${unit}`;
    }
  }
  return `${ms}ms`;
};

/** The declared threshold, as the hold is set: more than `count` in the window. */
export const thresholdLine = (threshold: FailureThreshold): string =>
  `more than ${threshold.count} failed targets in ${windowLabel(threshold.window_ms)}, set by ${threshold.actor} at ${new Date(threshold.set_at).toISOString()}`;

/** Whether, and when, the hold lifts without an operator. */
export const liftLine = (hold: DeliveryHold, threshold: FailureThreshold | undefined): string => {
  if (hold.actor !== AUTOMATIC_ACTOR) {
    return "never lifts itself";
  }
  return threshold
    ? `lifts itself at ${threshold.count} or fewer failed targets in ${windowLabel(threshold.window_ms)}`
    : "does not lift itself while no threshold is set";
};

/** Newest first, so the latest transition and its actor lead. */
export const recentAudit = (audit: HoldAuditEvent[], limit = 5): HoldAuditEvent[] =>
  audit.toSorted((left, right) => right.at - left.at).slice(0, limit);

export const auditLine = (event: HoldAuditEvent): string =>
  `${event.action} by ${event.actor} at ${new Date(event.at).toISOString()}: ${event.reason}`;
