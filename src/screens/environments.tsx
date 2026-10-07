import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type {
  EnvironmentInspectReport,
  ManagementLifecycleResult,
  RetireEnvironmentRequest,
} from "../api/tenkai.gen";
import { useSession } from "../auth/session";
import { channelTable, environmentRows } from "../delivery/configuration";
import { useDelivery } from "../delivery/use-delivery";
import { useManagementCall } from "../management/use-management";
import { expectedGeneration, subscribeBody } from "../plan/requests";
import { Button, Card, ConfirmButton, Notice } from "../ui/kit";

const th = "border-b border-line px-3.5 py-2 text-left font-medium whitespace-nowrap text-muted";
const td = "border-b border-line px-3.5 py-2 align-top";

/**
 * Decision 4D: environments as a top tab, one table, the selected row's detail
 * below. The detail subscribes a product channel and retires the environment.
 */
export const Environments = () => {
  const token = useSession((state) => state.session?.accessToken);
  const delivery = useDelivery(token);
  const rows = environmentRows(delivery.reports);
  const [selected, setSelected] = useState<string>();
  // A retired or vanished selection falls back to the first environment.
  const shown = rows.some((row) => row.name === selected) ? selected : rows[0]?.name;
  const report = delivery.reports.find((candidate) => candidate.name === shown);
  const { products, channels } = channelTable(delivery.reports);

  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="m-0 text-lg font-semibold">Environments</h1>
        <span className="text-xs text-muted">
          {delivery.error
            ? delivery.error.message
            : delivery.loading
              ? "Loading"
              : `${rows.length} active`}
        </span>
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className={th}>Environment</th>
              <th className={th}>Channels</th>
              <th className={th}>Deployed</th>
              <th className={th}>Facts</th>
              <th className={th}>Lease</th>
              <th className={th}>Latest plan</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.name}
                aria-selected={row.name === report?.name}
                onClick={() => setSelected(row.name)}
                className={`cursor-pointer [&:last-child>td]:border-b-0 ${row.name === report?.name ? "bg-selected" : ""}`}
              >
                <td className={`${td} font-semibold`}>{row.name}</td>
                <td className={td}>{row.channels.join(", ") || "none"}</td>
                <td className={`${td} font-mono`}>
                  {row.deployed}/{row.subscribed}
                </td>
                <td className={`${td} text-muted`}>{row.facts || "none"}</td>
                <td className={td}>{row.lease}</td>
                <td className={td}>{row.plan}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {report && token && (
        <Detail key={report.name} report={report} token={token} known={{ products, channels }} />
      )}
    </>
  );
};

const field =
  "min-w-0 flex-1 rounded-md border border-field bg-white/4 px-2.5 py-1.5 text-xs text-fg placeholder:text-muted";
const message = (result: ManagementLifecycleResult) => result.message;

const Detail = ({
  report,
  token,
  known,
}: {
  report: EnvironmentInspectReport;
  token: string;
  known: { products: string[]; channels: string[] };
}) => {
  const scope = `environment:${report.name}` as const;
  const path = `v1/environments/${encodeURIComponent(report.name)}`;
  const generation = expectedGeneration(report.lease);
  const retire = useManagementCall(token, scope, message);
  const subscribe = useManagementCall(token, scope, message);
  const [reason, setReason] = useState("");
  const [product, setProduct] = useState("");
  const [channel, setChannel] = useState("");
  const spec = `${product.trim()}=${channel.trim()}`;

  return (
    <>
      <div className="mt-[18px] mb-2 flex items-baseline gap-2 text-[13px] font-semibold">
        {report.name}
        <span className="font-mono text-[11px] font-medium text-muted">{report.description}</span>
        <Link
          to="/environments/$environment/plan"
          params={{ environment: report.name }}
          className="ml-auto text-xs font-medium text-muted"
        >
          Open plan
        </Link>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className={th}>Product</th>
                <th className={th}>Channel</th>
                <th className={th}>Deployed</th>
                <th className={th}>Head</th>
              </tr>
            </thead>
            <tbody>
              {report.subscriptions.map((subscription) => (
                <tr key={subscription.product} className="[&:last-child>td]:border-b-0">
                  <td className={td}>{subscription.product}</td>
                  <td className={td}>{subscription.channel}</td>
                  <td
                    className={`${td} font-mono ${subscription.state === "current" ? "text-ok" : "text-warning"}`}
                  >
                    {subscription.deployed ?? "none"}
                  </td>
                  <td className={`${td} font-mono`}>{subscription.head}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {subscribe.allowed && (
            <div className="flex flex-wrap gap-2 border-t border-line px-3.5 py-3">
              <input
                aria-label="Product"
                placeholder="Product"
                list="known-products"
                value={product}
                onChange={(event) => setProduct(event.target.value)}
                className={field}
              />
              <input
                aria-label="Channel"
                placeholder="Channel"
                list="known-channels"
                value={channel}
                onChange={(event) => setChannel(event.target.value)}
                className={field}
              />
              <datalist id="known-products">
                {known.products.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              <datalist id="known-channels">
                {known.channels.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              <ConfirmButton
                label="Subscribe"
                confirm={`Subscribe ${report.name} to ${spec}`}
                disabled={!product.trim() || !channel.trim() || subscribe.isPending}
                onConfirm={() =>
                  subscribe.mutate({
                    path: `${path}/subscriptions`,
                    body: subscribeBody(report.name, generation, product.trim(), channel.trim()),
                  })
                }
              />
            </div>
          )}
          {subscribe.outcome && (
            <div className="px-3.5 pb-3">
              <Notice tone={subscribe.outcome.tone}>{subscribe.outcome.text}</Notice>
            </div>
          )}
        </Card>
        <Card>
          <dl className="m-0 grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 px-3.5 py-3 text-xs">
            {Object.entries(report.facts).map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-muted">{key}</dt>
                <dd className="m-0">{value}</dd>
              </div>
            ))}
            <dt className="text-muted">lease</dt>
            <dd className="m-0">
              {report.lease.held ? `held, generation ${report.lease.generation ?? 0}` : "free"}
            </dd>
          </dl>
          {retire.allowed && (
            <div className="flex gap-2 border-t border-line px-3.5 py-3">
              <input
                aria-label="Retirement reason"
                placeholder="Reason to retire"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className={field}
              />
              <Button
                disabled={!reason.trim() || retire.isPending}
                onClick={() =>
                  retire.mutate({
                    path: `${path}/retire`,
                    body: {
                      version: 1,
                      operation: "retire",
                      reason,
                    } satisfies RetireEnvironmentRequest,
                  })
                }
              >
                Retire
              </Button>
            </div>
          )}
          {retire.outcome && (
            <div className="px-3.5 pb-3">
              <Notice tone={retire.outcome.tone}>{retire.outcome.text}</Notice>
            </div>
          )}
        </Card>
      </div>
    </>
  );
};
