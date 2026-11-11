import { parseInspectDrift } from "../delivery/drift";
import { Card } from "../ui/kit";

const th = "border-b border-line px-3.5 py-2 text-left font-medium whitespace-nowrap text-muted";
const td = "border-b border-line px-3.5 py-2 align-top";

const COPY = {
  unavailable: "This server does not report drift.",
  empty: "none",
} as const;

const STATUS_TONE = {
  none: "text-ok",
  unavailable: "text-muted",
  drifted: "text-warning",
} as const;

/**
 * Report-only live-spec drift for the selected environment.
 * Inspect `spec_drift`; Tenkai does not act on it, and neither does this table.
 */
export const EnvironmentDrift = ({ report }: { report: unknown }) => {
  const load = parseInspectDrift(report);
  return (
    <>
      <h2 className="mt-[18px] mb-2 text-[13px] font-semibold">Drift</h2>
      <Card className="overflow-x-auto">
        {load.kind === "unavailable" ? (
          <p className="m-0 px-3.5 py-3 text-xs text-muted">{COPY.unavailable}</p>
        ) : load.kind === "none" ? (
          <p className="m-0 px-3.5 py-3 text-xs text-muted">{COPY.empty}</p>
        ) : (
          <table className="w-full border-collapse text-xs" aria-label="Drift">
            <thead>
              <tr>
                <th className={th}>Instance</th>
                <th className={th}>Release</th>
                <th className={th}>Object</th>
                <th className={th}>Differs</th>
                <th className={th}>Status</th>
                <th className={th}>Hold</th>
              </tr>
            </thead>
            <tbody>
              {load.rows.map((row) => (
                <tr
                  key={`${row.instance}:${row.object}:${row.differs}`}
                  className="[&:last-child>td]:border-b-0"
                >
                  <td className={`${td} font-mono`}>{row.instance}</td>
                  <td className={`${td} font-mono`}>{row.release}</td>
                  <td className={`${td} font-mono`}>{row.object}</td>
                  <td className={`${td} font-mono`}>{row.differs}</td>
                  <td className={`${td} ${STATUS_TONE[row.status]}`}>{row.status}</td>
                  <td className={`${td} ${row.held ? "text-warning" : "text-muted"}`}>
                    {row.held ? "held" : "none"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
};

export default EnvironmentDrift;
