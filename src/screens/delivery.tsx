import { Link } from "@tanstack/react-router";
import type { FleetStatusReport } from "../api/tenkai.gen";
import type { FleetAttention, FleetTableRow } from "../delivery/configuration";
import { Card } from "../ui/kit";

const DOT = { warn: "bg-warning", bad: "bg-danger" } as const;
const th = "border-b border-line px-3.5 py-2 text-left font-medium whitespace-nowrap text-muted";
const td = "border-b border-line px-3.5 py-2";

/** What needs you first, then fleet counts from bulk routes. */
export const Delivery = ({
  rows,
  items,
  fleet,
}: {
  rows: FleetTableRow[];
  items: FleetAttention[];
  fleet: FleetStatusReport | undefined;
}) => {
  if (rows.length === 0) {
    return (
      <p className="m-0 text-xs text-muted">No environments yet. Add one with tenkaictl env add.</p>
    );
  }

  return (
    <>
      {items.length > 0 && (
        <Card>
          {items.map((item) => (
            <div
              key={`${item.environment}/${item.next}`}
              className="grid grid-cols-[10px_1fr_auto] items-center gap-3 border-t border-line px-3.5 py-2.5 first:border-t-0"
            >
              <span className={`size-[7px] rounded-full ${DOT[item.tone]}`} />
              <div>
                <div className="text-[13px] font-semibold">{item.environment}</div>
                <div className="text-xs text-muted">{item.detail}</div>
              </div>
              <Link
                to="/environments"
                search={{ environment: item.environment }}
                className="inline-flex items-center rounded-md border border-field px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap text-fg no-underline"
              >
                {item.next}
              </Link>
            </div>
          ))}
        </Card>
      )}

      <h2 className="mt-[18px] mb-2 text-[13px] font-semibold">All deliveries</h2>
      <Card className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className={th}>Environments</th>
              <th className={th}>Current</th>
              <th className={th}>Behind</th>
              <th className={th}>Unhealthy</th>
              <th className={th}>Empty</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className={`${td} font-semibold`}>{fleet?.environment_count ?? rows.length}</td>
              <td className={`${td} text-ok`}>{fleet?.environments_current ?? "·"}</td>
              <td className={`${td} text-warning`}>{fleet?.environments_behind ?? "·"}</td>
              <td className={`${td} text-danger`}>{fleet?.environments_unhealthy ?? "·"}</td>
              <td className={td}>{fleet?.environments_empty ?? "·"}</td>
            </tr>
          </tbody>
        </table>
      </Card>
    </>
  );
};
