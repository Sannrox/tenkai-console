import { type StatusLoad, identityRows } from "../delivery/identity";
import { Card } from "../ui/kit";

const th = "border-b border-line px-3.5 py-2 text-left font-medium whitespace-nowrap text-muted";
const td = "border-b border-line px-3.5 py-2 align-top";

const COPY = {
  unavailable: "This server does not report instance identity.",
  forbidden: "No access",
  empty: "none",
} as const;

const TONE = {
  ok: "text-ok",
  warn: "text-warning",
  bad: "text-danger",
  muted: "text-muted",
} as const;

/**
 * Report-only workload identity per instance.
 * GET `/v1/environments/{environment}/status` `certificate`.
 */
export const EnvironmentIdentity = ({
  environment,
  instances,
  load,
  now,
}: {
  environment: string;
  instances: readonly string[];
  load: StatusLoad | undefined;
  now: number;
}) => {
  const rows =
    load?.kind === "ok"
      ? identityRows(environment, instances, load.value, Math.floor(now / 1000))
      : [];
  return (
    <>
      <h2 className="mt-[18px] mb-2 text-[13px] font-semibold">Identity</h2>
      <Card className="overflow-x-auto">
        {load === undefined ? (
          <p className="m-0 px-3.5 py-3 text-xs text-muted">Loading</p>
        ) : load.kind === "unavailable" ? (
          <p className="m-0 px-3.5 py-3 text-xs text-muted">{COPY.unavailable}</p>
        ) : load.kind === "forbidden" ? (
          <p className="m-0 px-3.5 py-3 text-xs text-muted">{COPY.forbidden}</p>
        ) : load.kind === "error" ? (
          <p role="alert" className="m-0 px-3.5 py-3 text-xs text-danger">
            {load.message}
          </p>
        ) : rows.every((row) => row.state === "none") ? (
          <p className="m-0 px-3.5 py-3 text-xs text-muted">{COPY.empty}</p>
        ) : (
          <table className="w-full border-collapse text-xs" aria-label="Identity">
            <thead>
              <tr>
                <th className={th}>Instance</th>
                <th className={th}>Identity</th>
                <th className={th}>State</th>
                <th className={th}>Expires</th>
                <th className={th}>Renewal</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.instance} className="[&:last-child>td]:border-b-0">
                  <td className={`${td} font-mono`}>{row.instance}</td>
                  <td className={`${td} font-mono ${row.identity === "none" ? "text-muted" : ""}`}>
                    {row.identity}
                  </td>
                  <td className={`${td} ${TONE[row.tone]}`}>{row.state}</td>
                  <td className={`${td} font-mono ${row.expires === "none" ? "text-muted" : ""}`}>
                    {row.expires}
                  </td>
                  <td className={`${td} ${row.failure === "none" ? "text-muted" : "text-warning"}`}>
                    {row.failure}
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

export default EnvironmentIdentity;
