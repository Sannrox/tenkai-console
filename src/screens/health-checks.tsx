import type { HealthCheckView } from "../delivery/instances";

const TONE = {
  ok: "text-ok",
  warn: "text-warning",
  bad: "text-danger",
  muted: "text-muted",
} as const;

/** The reported checks under an instance's health, one line each, worst first. */
export const HealthChecks = ({ checks }: { checks: readonly HealthCheckView[] }) =>
  checks.map((check) => (
    <div key={check.name} className={`min-w-48 font-mono break-words ${TONE[check.tone]}`}>
      {check.name} {check.state}
      {check.message && `: ${check.message}`}
    </div>
  ));
