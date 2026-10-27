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

/** What the rollback dialog states before anything is sent (#28, pick B). */
export const rollbackSummary = (
  report: EnvironmentInspectReport,
  product: string,
  previous: string | undefined,
): Array<{ label: string; value: string }> => {
  const deployed =
    report.subscriptions.find((subscription) => subscription.product === product)?.deployed ??
    "unknown";
  return [
    { label: "product", value: product },
    { label: "from → to", value: `${deployed} → ${previous ?? "previous release"}` },
    { label: "approval", value: "required: a human-signed downgrade approval" },
  ];
};

/** The dialog's Roll back is enabled only with a reason and the environment name typed exactly. */
export const rollbackConfirmed = (environment: string, typed: string, reason: string): boolean =>
  typed === environment && reason.trim().length > 0;
