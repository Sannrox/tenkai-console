// Kept apart from delivery/rollback.ts so it ships only in the lazy plan page.
import type { EnvironmentPlanSummary } from "../api/tenkai.gen";

/**
 * Every step is a rollback, so a successful apply holds the environment unless
 * the apply opts out. A truncated step list is not known to be rollback-only.
 */
export const rollbackOnly = (
  plan: Pick<EnvironmentPlanSummary, "steps" | "steps_truncated">,
): boolean =>
  plan.steps_truncated !== true &&
  (plan.steps?.length ?? 0) > 0 &&
  (plan.steps ?? []).every((step) => step.action === "rollback");

/**
 * The hold choice on a rollback apply. Keeping the hold sends nothing extra;
 * skipping it needs a reason, sent as `no_hold_reason`. `undefined` while the
 * opt-out has no reason yet.
 */
export const rollbackHoldChoice = (
  hold: boolean,
  reason: string,
): { noHoldReason?: string } | undefined => {
  if (hold) {
    return {};
  }
  const trimmed = reason.trim();
  return trimmed === "" ? undefined : { noHoldReason: trimmed };
};
