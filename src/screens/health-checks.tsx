import type { InstanceHealthView } from "../delivery/instances";

const TONE = {
  ok: "text-ok",
  warn: "text-warning",
  bad: "text-danger",
  muted: "text-muted",
} as const;

/**
 * Under an instance's health label: when it was last observed, then the
 * reported checks, one line each, worst first. No time when the server sent none.
 */
export const HealthChecks = ({ health }: { health: InstanceHealthView }) => (
  <>
    {health.observed && (
      <div className="font-mono whitespace-nowrap text-muted">observed {health.observed}</div>
    )}
    {health.checks.map((check) => (
      <div key={check.name} className={`min-w-48 font-mono break-words ${TONE[check.tone]}`}>
        {check.name} {check.state}
        {check.message && `: ${check.message}`}
      </div>
    ))}
  </>
);
