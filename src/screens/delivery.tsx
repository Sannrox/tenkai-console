import { Link } from "@tanstack/react-router";
import type { EnvironmentInspectReport } from "../api/tenkai.gen";
import { type Tone, attention, matrix } from "../delivery/model";
import { Card } from "../ui/kit";

const TEXT: Record<Tone, string> = {
  ok: "text-ok",
  warn: "text-warning",
  bad: "text-danger",
  muted: "text-muted",
};
const DOT = { warn: "bg-warning", bad: "bg-danger" } as const;

/** Decision 2B: what needs you first, then every delivery. */
export const Delivery = ({ reports }: { reports: EnvironmentInspectReport[] }) => {
  const items = attention(reports);
  const grid = matrix(reports);

  if (reports.length === 0) {
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
              key={`${item.environment}/${item.product ?? "plan"}`}
              className="grid grid-cols-[10px_1fr_auto] items-center gap-3 border-t border-line px-3.5 py-2.5 first:border-t-0"
            >
              <span className={`size-[7px] rounded-full ${DOT[item.tone]}`} />
              <div>
                <div className="text-[13px] font-semibold">
                  {item.product
                    ? `${item.product} · ${item.environment}`
                    : `${item.environment} plan`}
                </div>
                <div className="text-xs text-muted">{item.detail}</div>
              </div>
              <Link
                to="/environments/$environment/plan"
                params={{ environment: item.environment }}
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
              <th className="border-b border-line px-3 py-2 text-left font-medium whitespace-nowrap text-muted">
                Product
              </th>
              {grid.columns.map((column) => (
                <th
                  key={column.environment}
                  className="border-b border-line px-3 py-2 text-left font-medium whitespace-nowrap text-muted"
                >
                  {column.environment}
                  {column.channel && (
                    <small className="block font-mono text-[10px]">{column.channel}</small>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.products.map((product) => (
              <tr key={product} className="[&:last-child>td]:border-b-0">
                <td className="border-b border-line px-3 py-2 font-semibold whitespace-nowrap">
                  {product}
                </td>
                {grid.columns.map((column) => {
                  const value = grid.cell(product, column.environment);
                  return (
                    <td
                      key={column.environment}
                      className="border-b border-l border-line px-3 py-2 whitespace-nowrap"
                    >
                      {value ? (
                        <Link
                          to="/environments/$environment/plan"
                          params={{ environment: column.environment }}
                          className="block text-inherit no-underline"
                        >
                          <span className={`font-mono ${TEXT[value.tone]}`}>{value.version}</span>
                          <span className="block text-[11px] text-muted">
                            {value.status}
                            {!column.channel && ` · ${value.channel}`}
                          </span>
                        </Link>
                      ) : (
                        <span className="text-muted">·</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
};
