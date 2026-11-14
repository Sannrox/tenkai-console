import type { FailureGroup } from "../delivery/attribution";
import type { EndpointRow, Tone } from "../delivery/owners";
import { Button, Card } from "../ui/kit";

// Shared owner reachability and delivery failure tables, for environment and
// product owners. Both lazily loaded with the sections that use them.

export const TONE: Record<Tone, string> = {
  ok: "text-ok",
  warn: "text-warning",
  bad: "text-danger",
  muted: "text-muted",
};

const th = "border-b border-line px-3.5 py-2 text-left font-medium whitespace-nowrap text-muted";
const td = "border-b border-line px-3.5 py-2 align-top";

/**
 * One row per endpoint, as the server judged it from recorded deliveries.
 * Rows carrying a product get a leading Product column.
 */
export const Endpoints = ({ rows }: { rows: (EndpointRow & { product?: string })[] }) => {
  const products = rows.some((row) => row.product !== undefined);
  return (
    <Card className="mt-1 overflow-x-auto">
      <table aria-label="Endpoint reachability" className="w-full border-collapse text-xs">
        <thead>
          <tr>
            {products && <th className={th}>Product</th>}
            <th className={th}>Endpoint</th>
            <th className={th}>Reachability</th>
            <th className={th}>Failures</th>
            <th className={th}>Last success</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.product ?? ""} ${row.url}`} className="[&:last-child>td]:border-b-0">
              {products && <td className={`${td} font-semibold`}>{row.product}</td>}
              <td className={`${td} font-mono whitespace-nowrap`}>{row.url}</td>
              <td className={`${td} ${TONE[row.tone]}`}>{row.verdict}</td>
              <td className={`${td} font-mono`}>{row.failures}</td>
              <td className={`${td} font-mono whitespace-nowrap`}>{row.lastSuccess}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
};

/**
 * Failing deliveries by the configuration that routed them and its owner. A
 * URL an environment and a product share is one row naming both; a delivery
 * the server named no source for reads unattributed.
 */
export const DeliveryFailures = ({
  groups,
  partial,
}: {
  groups: FailureGroup[];
  /** Deliveries counted, when more exist past them: the counts are not complete. */
  partial?: number | undefined;
}) => (
  <>
    <div className="mt-3 mb-1 flex flex-wrap items-baseline gap-2">
      <h3 className="m-0 text-xs font-semibold">Delivery failures</h3>
      {partial !== undefined && (
        <span aria-label="Delivery failures partial" className="text-xs text-warning">
          {partialLine(partial)}
        </span>
      )}
    </div>
    <Card className="overflow-x-auto">
      {groups.length === 0 ? (
        <p className="m-0 px-3.5 py-3 text-xs text-muted">none</p>
      ) : (
        <table aria-label="Delivery failures" className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className={th}>Source</th>
              <th className={th}>Owner</th>
              <th className={th}>Failures</th>
              <th className={th}>URL</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <tr key={group.key} className="[&:last-child>td]:border-b-0">
                {group.sources.length === 0 ? (
                  <>
                    <td className={`${td} text-warning`}>unattributed</td>
                    <td className={`${td} text-muted`}>·</td>
                  </>
                ) : (
                  <>
                    <td className={`${td} whitespace-nowrap`}>
                      {group.sources.map((source) => (
                        <div key={`${source.kind} ${source.name}`}>
                          <span className="text-muted">{source.kind}</span> {source.name}
                        </div>
                      ))}
                    </td>
                    <td className={`${td} whitespace-nowrap`}>
                      {group.sources.map((source) => (
                        <div
                          key={`${source.kind} ${source.name}`}
                          className={
                            source.owner === "·" || source.owner === "none" ? "text-muted" : ""
                          }
                        >
                          {source.owner}
                        </div>
                      ))}
                    </td>
                  </>
                )}
                <td className={`${td} font-mono text-danger`}>{group.failures}</td>
                <td className={`${td} font-mono whitespace-nowrap`}>
                  {group.urls.map((url) => (
                    <div key={url}>{url}</div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  </>
);

const partialLine = (shown: number) =>
  `in the newest ${shown} ${shown === 1 ? "delivery" : "deliveries"}, more exist`;

/**
 * Says a delivery list is partial and offers its next page on request; nothing
 * once the list is complete. A failed next page keeps what is shown, says so
 * without the server's text, and the same button asks again.
 */
export const MoreDeliveries = ({
  shown,
  failed,
  of,
  loading,
  onMore,
}: {
  shown: number;
  /** The last next-page read failed, for the lists named in `of` where there are several. */
  failed: boolean;
  of?: string[];
  loading: boolean;
  onMore: () => void;
}) => (
  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
    <span aria-label="Deliveries partial" className="text-warning">
      newest {shown} shown, more exist
    </span>
    <Button disabled={loading} onClick={onMore}>
      {loading ? "Loading" : "Load more"}
    </Button>
    {failed && (
      <span role="alert" className="text-danger">
        Could not load more{of && of.length > 0 ? ` deliveries of ${of.join(", ")}` : ""}
      </span>
    )}
  </div>
);
