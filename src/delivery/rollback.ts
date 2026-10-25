import type { EnvironmentInspectReport } from "../api/tenkai.gen";

/** Shown before submit: rollback is a downgrade; automatic envelopes are not reused. */
export const DOWNGRADE_NOTICE =
  "This is a downgrade. Apply will wait for a human-signed approval. Automatic envelopes are not reused.";

/**
 * Previous pin named by inspect only when a succeeded upgrade produced the
 * currently deployed version. Inspect does not return `deployed_prev`, and a
 * computed or failed upgrade's `from` is not the rollback target.
 */
export const previousRelease = (
  report: EnvironmentInspectReport,
  product: string,
): string | undefined => {
  const deployed = report.subscriptions.find(
    (subscription) => subscription.product === product,
  )?.deployed;
  if (!deployed || report.latest_plan?.state !== "succeeded") {
    return undefined;
  }
  const step = report.latest_plan.steps?.find(
    (candidate) =>
      candidate.product === product &&
      candidate.action === "upgrade" &&
      candidate.to === deployed &&
      candidate.from,
  );
  return step?.from ?? undefined;
};

/** Confirmation names the previous release when inspect still reports it. */
export const rollbackConfirm = (product: string, previous: string | undefined): string =>
  previous
    ? `Confirm roll back ${product} to ${previous}`
    : `Confirm roll back ${product} to the previous release`;
