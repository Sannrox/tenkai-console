import {
  type OverlayRefusal,
  overlayRows,
  parseInspectConfig,
  schemaHeads,
  withRefusal,
} from "../delivery/config-schema";
import { Card } from "../ui/kit";

const th = "border-b border-line px-3.5 py-2 text-left font-medium whitespace-nowrap text-muted";
const td = "border-b border-line px-3.5 py-2 align-top";

const CHECK_TONE = {
  checked: "text-ok",
  declared: "text-muted",
} as const;

/**
 * Overlay keys, defaults, and declared secret names from inspect, plus a
 * plan or overlay-set refusal when the server named a failing key.
 */
export const EnvironmentOverlays = ({
  report,
  refusal,
}: {
  report: unknown;
  refusal?: OverlayRefusal;
}) => {
  const config = parseInspectConfig(report);
  const heads = schemaHeads(report);
  const rows = withRefusal(overlayRows(config, heads), refusal, config, heads);
  if (rows.length === 0) {
    return null;
  }
  return (
    <>
      <h2 className="mt-[18px] mb-2 text-[13px] font-semibold">Overlays</h2>
      <Card className="overflow-x-auto">
        <table className="w-full border-collapse text-xs" aria-label="Overlays">
          <thead>
            <tr>
              <th className={th}>Product</th>
              <th className={th}>Key</th>
              <th className={th}>Value</th>
              <th className={th}>Source</th>
              <th className={th}>Check</th>
              <th className={th}>Schema</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const passing = row.check === "checked" || row.check === "declared";
              return (
                <tr
                  key={`${row.product}:${row.source}:${row.key}`}
                  className="[&:last-child>td]:border-b-0"
                >
                  <td className={td}>{row.product}</td>
                  <td className={`${td} font-mono`}>{row.key}</td>
                  <td className={`${td} font-mono ${row.value === "" ? "text-muted" : ""}`}>
                    {row.source === "secret" || row.value === "" ? "·" : row.value}
                  </td>
                  <td className={td}>{row.source}</td>
                  <td
                    className={`${td} ${passing ? CHECK_TONE[row.check === "declared" ? "declared" : "checked"] : "text-danger"}`}
                    {...(passing ? {} : { role: "alert" })}
                  >
                    {row.check}
                  </td>
                  <td className={`${td} font-mono`}>{row.schema}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </>
  );
};

export default EnvironmentOverlays;
