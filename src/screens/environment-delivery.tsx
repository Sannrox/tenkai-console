import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  COPY,
  DEFAULT_PERIOD_DAYS,
  PERIOD_DAYS,
  type DeliveryMetrics,
  type Figure,
  channelLine,
  deployFigure,
  exposureFigure,
  failureFigure,
  fetchReport,
  historySearch,
  leadFigure,
  periodLine,
  reportQuery,
  restoreFigure,
} from "../delivery/delivery-report";
import { Card } from "../ui/kit";

const th = "border-b border-line px-3.5 py-2 text-left font-medium whitespace-nowrap text-muted";
const td = "border-b border-line px-3.5 py-2 align-top";

/**
 * Delivery metrics for the selected environment.
 * GET `/v1/environments/{environment}/delivery-report`.
 */
export const EnvironmentDelivery = ({
  environment,
  token,
}: {
  environment: string;
  token: string;
}) => {
  const [days, setDays] = useState<number>(DEFAULT_PERIOD_DAYS);
  const query = useQuery({
    queryKey: ["delivery-report", environment, days, token],
    queryFn: async () => {
      const load = await fetchReport(environment, token, reportQuery(days, Date.now()));
      if (load.kind === "error") {
        throw new Error(load.message);
      }
      return load;
    },
    enabled: Boolean(environment),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });
  const load = query.data;
  const loadError = query.error instanceof Error ? query.error.message : "Could not load";
  const period = load?.kind === "ok" ? periodLine(load.value.since_ms, load.value.until_ms) : "";

  let body;
  if (query.isPending && load === undefined) {
    body = <p className="m-0 px-3.5 py-3 text-xs text-muted">{COPY.loading}</p>;
  } else if (load?.kind === "unavailable") {
    body = <p className="m-0 px-3.5 py-3 text-xs text-muted">{COPY.unavailable}</p>;
  } else if (load?.kind === "forbidden") {
    body = <p className="m-0 px-3.5 py-3 text-xs text-muted">{COPY.forbidden}</p>;
  } else if (load === undefined) {
    body = (
      <p role="alert" className="m-0 px-3.5 py-3 text-xs text-danger">
        {loadError}
      </p>
    );
  } else if (load.value.missing_data) {
    body =
      load.value.rows.length === 0 ? (
        <p className="m-0 px-3.5 py-3 text-xs text-muted">{COPY.missing}</p>
      ) : (
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className={th}>Product</th>
              <th className={th}>Channel</th>
              <th className={th}>Report</th>
            </tr>
          </thead>
          <tbody>
            {load.value.rows.map((row) => (
              <tr
                key={`${row.product}/${row.channel ?? ""}`}
                className="[&:last-child>td]:border-b-0"
              >
                <td className={`${td} font-mono`}>{row.product}</td>
                <td
                  className={`${td} ${channelLine(row.channel) === COPY.empty ? "text-muted" : ""}`}
                >
                  {channelLine(row.channel)}
                </td>
                <td className={td}>{COPY.missing}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
  } else if (load.value.rows.length === 0) {
    body = <p className="m-0 px-3.5 py-3 text-xs text-muted">{COPY.empty}</p>;
  } else {
    body = (
      <table aria-label="Delivery metrics" className="w-full border-collapse text-xs">
        <thead>
          <tr>
            <th className={th}>Product</th>
            <th className={th}>Channel</th>
            <th className={th}>Deploys</th>
            <th className={th}>Failure</th>
            <th className={th}>Lead time</th>
            <th className={th}>Restore</th>
            <th className={th}>Exposure</th>
          </tr>
        </thead>
        <tbody>
          {load.value.rows.map((row) => (
            <MetricRow
              key={`${row.product}/${row.channel ?? ""}`}
              environment={environment}
              period={period}
              row={row}
            />
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <section aria-label="Delivery metrics">
      <div className="mt-[18px] mb-2 flex flex-wrap items-baseline gap-2">
        <h2 className="m-0 text-[13px] font-semibold">Delivery metrics</h2>
        {period !== "" && (
          <span aria-label="Report period" className="text-xs text-muted">
            {period}
          </span>
        )}
        <label className="ml-auto flex items-center gap-2 text-xs font-medium text-muted">
          Period
          <select
            aria-label="Period"
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
            className="rounded-md border border-field bg-white/4 px-2.5 py-1.5 text-xs text-fg"
          >
            {PERIOD_DAYS.map((value) => (
              <option key={value} value={value}>
                {value} days
              </option>
            ))}
          </select>
        </label>
      </div>
      <Card className="max-w-full min-w-0 overflow-x-auto">{body}</Card>
    </section>
  );
};

const MetricRow = ({
  environment,
  period,
  row,
}: {
  environment: string;
  period: string;
  row: DeliveryMetrics;
}) => {
  const channel = channelLine(row.channel);
  return (
    <tr className="[&:last-child>td]:border-b-0">
      <td className={`${td} font-mono`}>{row.product}</td>
      <td className={`${td} ${channel === COPY.empty ? "text-muted" : ""}`}>{channel}</td>
      <td className={td}>
        <FigureLink
          environment={environment}
          period={period}
          product={row.product}
          label="deploys"
          figure={deployFigure(row)}
        />
      </td>
      <td className={td}>
        <FigureLink
          environment={environment}
          period={period}
          product={row.product}
          label="failure"
          figure={failureFigure(row)}
        />
      </td>
      <td className={td}>
        <FigureLink
          environment={environment}
          period={period}
          product={row.product}
          label="lead time"
          figure={leadFigure(row)}
        />
      </td>
      <td className={td}>
        <FigureLink
          environment={environment}
          period={period}
          product={row.product}
          label="restore"
          figure={restoreFigure(row)}
        />
      </td>
      <td className={td}>
        <FigureLink
          environment={environment}
          period={period}
          product={row.product}
          label="exposure"
          figure={exposureFigure(row)}
        />
      </td>
    </tr>
  );
};

const FigureLink = ({
  environment,
  period,
  product,
  label,
  figure,
}: {
  environment: string;
  period: string;
  product: string;
  label: string;
  figure: Figure | undefined;
}) => {
  if (figure === undefined) {
    return <span className="text-muted">{COPY.empty}</span>;
  }
  return (
    <Link
      to="/environments/$environment/history"
      params={{ environment }}
      search={historySearch(environment, product)}
      aria-label={`${figure.value} ${label}, ${figure.count}, ${period}`}
      className="font-medium text-muted"
    >
      {figure.value}
      {figure.count !== figure.value && <div className="font-normal">{figure.count}</div>}
    </Link>
  );
};

export default EnvironmentDelivery;
