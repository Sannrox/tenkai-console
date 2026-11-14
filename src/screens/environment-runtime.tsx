import { useQuery } from "@tanstack/react-query";
import { request } from "../api/http";
import type { EnvironmentInspectReport, EnvironmentRuntimeReport } from "../api/tenkai.gen";
import { runtimeRows } from "../delivery/runtime";
import { Card } from "../ui/kit";

const th = "border-b border-line px-3.5 py-2 text-left font-medium whitespace-nowrap text-muted";
const td = "border-b border-line px-3.5 py-2 align-top";

const HEALTH_TONE = {
  ok: "text-ok",
  warn: "text-warning",
  bad: "text-danger",
  muted: "text-muted",
} as const;

/** Observed Docker and model runtime for the selected environment only. */
export const Runtime = ({ report, token }: { report: EnvironmentInspectReport; token: string }) => {
  const runtime = useQuery({
    queryKey: ["runtime", report.name, token],
    queryFn: () =>
      request<EnvironmentRuntimeReport>(
        `v1/environments/${encodeURIComponent(report.name)}/runtime`,
        { token },
      ),
    retry: false,
  });
  const rows = runtime.data ? runtimeRows(runtime.data) : [];

  return (
    <>
      <div className="mt-[18px] mb-2 text-[13px] font-semibold">Runtime</div>
      <Card className="overflow-x-auto">
        {runtime.error ? (
          <p role="alert" className="m-0 px-3.5 py-3 text-xs text-danger">
            {runtime.error.message}
          </p>
        ) : runtime.isPending ? (
          <p className="m-0 px-3.5 py-3 text-xs text-muted">Loading</p>
        ) : rows.length === 0 ? (
          <p className="m-0 px-3.5 py-3 text-xs text-muted">none</p>
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className={th}>Product</th>
                <th className={th}>Executor</th>
                <th className={th}>Health</th>
                <th className={th}>Units</th>
                <th className={th}>Init</th>
                <th className={th}>Model</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.product} className="[&:last-child>td]:border-b-0">
                  <td className={td}>{row.product}</td>
                  <td className={td}>{row.executor}</td>
                  <td className={`${td} ${HEALTH_TONE[row.healthTone]}`}>{row.health}</td>
                  <td className={`${td} font-mono ${row.units === "none" ? "text-muted" : ""}`}>
                    {row.units}
                  </td>
                  <td className={`${td} ${row.init === "none" ? "text-muted" : ""}`}>{row.init}</td>
                  <td className={`${td} font-mono ${row.model === "none" ? "text-muted" : ""}`}>
                    {row.model}
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
