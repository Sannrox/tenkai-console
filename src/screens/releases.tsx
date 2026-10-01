import { useSession } from "../auth/session";
import { channelTable } from "../delivery/configuration";
import { useDelivery } from "../delivery/use-delivery";
import { Card } from "../ui/kit";

const th = "border-b border-line px-3.5 py-2 text-left font-medium whitespace-nowrap text-muted";

/** Channels (decision 4D): the head each channel points to and who follows it. */
export const Releases = () => {
  const token = useSession((state) => state.session?.accessToken);
  const delivery = useDelivery(token);
  const table = channelTable(delivery.reports);

  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="m-0 text-lg font-semibold">Releases</h1>
        <span className="text-xs text-muted">
          {delivery.error
            ? delivery.error.message
            : delivery.loading
              ? "Loading"
              : `${table.channels.length} ${table.channels.length === 1 ? "channel" : "channels"}`}
        </span>
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className={th}>Product</th>
              {table.channels.map((channel) => (
                <th key={channel} className={th}>
                  {channel}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.products.map((product) => (
              <tr key={product} className="[&:last-child>td]:border-b-0">
                <td className="border-b border-line px-3.5 py-2 font-semibold">{product}</td>
                {table.channels.map((channel) => {
                  const head = table.head(product, channel);
                  return (
                    <td key={channel} className="border-b border-l border-line px-3.5 py-2">
                      {head ? (
                        <>
                          <span className="font-mono">{head}</span>
                          <span className="block text-[11px] text-muted">
                            {table.subscribers(product, channel).join(", ")}
                          </span>
                        </>
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
