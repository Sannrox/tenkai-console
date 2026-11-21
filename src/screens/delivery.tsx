import type { FleetStatusReport } from "../api/tenkai.gen";
import type { FleetTableRow } from "../delivery/configuration";
import { Card } from "../ui/kit";

const th = "border-b border-line px-3.5 py-2 text-left font-medium whitespace-nowrap text-muted";
const td = "border-b border-line px-3.5 py-2";

/** Fleet counts from bulk routes. */
export const Delivery = ({
  rows,
  fleet,
}: {
  rows: FleetTableRow[];
  fleet: FleetStatusReport | undefined;
}) => {
  const health = (summary: string) =>
    fleet?.environments.filter((row) => row.health_summary === summary).length ?? "·";
  if (rows.length === 0) {
    return (
      <p className="m-0 text-xs text-muted">No environments yet. Add one with tenkaictl env add.</p>
    );
  }

  return (
    <>
      <h2 className="mt-0 mb-2 text-[13px] font-semibold">Fleet</h2>
      <Card className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className={th}>Environments</th>
              <th className={th}>Current</th>
              <th className={th}>Behind</th>
              <th className={th}>Unhealthy</th>
              <th className={th}>Unknown</th>
              <th className={th}>Empty</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className={`${td} font-semibold`}>{fleet?.environment_count ?? rows.length}</td>
              <td className={`${td} text-ok`}>{fleet?.environments_current ?? "·"}</td>
              <td className={`${td} text-warning`}>{fleet?.environments_behind ?? "·"}</td>
              <td className={`${td} text-danger`}>{health("error")}</td>
              <td className={`${td} text-warning`}>{health("unknown")}</td>
              <td className={td}>{fleet?.environments_empty ?? "·"}</td>
            </tr>
          </tbody>
        </table>
      </Card>
    </>
  );
};
