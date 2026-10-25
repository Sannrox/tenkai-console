import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { EnvironmentInspectReport, ManagementLifecycleResult } from "../api/tenkai.gen";
import { type Attention, type Tone, attention, matrix } from "../delivery/model";
import { useManagementCall } from "../management/use-management";
import {
  expectedGeneration,
  releaseChannelHoldBody,
  releaseHoldBody,
  retryFailedTargetBody,
} from "../plan/requests";
import { Card, ConfirmButton, Notice } from "../ui/kit";

const TEXT: Record<Tone, string> = {
  ok: "text-ok",
  warn: "text-warning",
  bad: "text-danger",
  muted: "text-muted",
};
const DOT = { warn: "bg-warning", bad: "bg-danger" } as const;

const message = (result: ManagementLifecycleResult) => result.message;

/** Decision 2B: what needs you first, then every delivery. */
export const Delivery = ({
  reports,
  token,
}: {
  reports: EnvironmentInspectReport[];
  token: string | undefined;
}) => {
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
              key={`${item.environment}/${item.product ?? "-"}/${item.channel ?? "-"}/${item.next}`}
              className="grid grid-cols-[10px_1fr_auto] items-center gap-3 border-t border-line px-3.5 py-2.5 first:border-t-0"
            >
              <span className={`size-[7px] rounded-full ${DOT[item.tone]}`} />
              <div>
                <div className="text-[13px] font-semibold">
                  {item.product
                    ? `${item.product} · ${item.environment}`
                    : item.next === "Release hold"
                      ? `${item.environment} hold`
                      : `${item.environment} plan`}
                </div>
                <div className="text-xs text-muted">{item.detail}</div>
              </div>
              <AttentionNext item={item} reports={reports} token={token} />
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

const linkClass =
  "inline-flex items-center rounded-md border border-field px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap text-fg no-underline";

const AttentionNext = ({
  item,
  reports,
  token,
}: {
  item: Attention;
  reports: EnvironmentInspectReport[];
  token: string | undefined;
}) => {
  const report = reports.find((candidate) => candidate.name === item.environment);
  if (item.next === "Release hold" && token && report) {
    return <ReleaseHold item={item} report={report} token={token} />;
  }
  if (item.next === "Retry" && token && report && item.product) {
    return <RetryFailed item={item} report={report} token={token} />;
  }
  return (
    <Link
      to="/environments/$environment/plan"
      params={{ environment: item.environment }}
      className={linkClass}
    >
      {item.next}
    </Link>
  );
};

const ReleaseHold = ({
  item,
  report,
  token,
}: {
  item: Attention;
  report: EnvironmentInspectReport;
  token: string;
}) => {
  const scope = item.product && item.channel ? "fleet" : (`environment:${report.name}` as const);
  const call = useManagementCall(token, scope, "management", message);
  const generation = expectedGeneration(report.lease);
  const path =
    item.product && item.channel
      ? `v1/products/${encodeURIComponent(item.product)}/channels/${encodeURIComponent(item.channel)}/hold/release`
      : `v1/environments/${encodeURIComponent(report.name)}/hold/release`;
  const body =
    item.product && item.channel
      ? releaseChannelHoldBody()
      : releaseHoldBody(report.name, generation);
  return (
    <div className="flex flex-col items-end gap-1">
      {call.allowed && (
        <ConfirmButton
          label={item.next}
          confirm={`Release hold on ${item.product ? `${item.product}/${item.channel}` : report.name}`}
          disabled={call.isPending}
          onConfirm={() => call.mutate({ path, body })}
        />
      )}
      {call.outcome && <Notice tone={call.outcome.tone}>{call.outcome.text}</Notice>}
    </div>
  );
};

const RetryFailed = ({
  item,
  report,
  token,
}: {
  item: Attention;
  report: EnvironmentInspectReport;
  token: string;
}) => {
  const [reason, setReason] = useState("");
  const scope = `environment:${report.name}` as const;
  const call = useManagementCall(token, scope, "management", message);
  const product = item.product;
  if (!product) {
    return null;
  }
  return (
    <div className="flex flex-col items-end gap-1">
      {call.allowed && (
        <>
          <input
            aria-label={`Retry reason for ${product}`}
            placeholder="Reason to retry"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="min-w-40 rounded-md border border-field bg-white/4 px-2.5 py-1.5 text-xs text-fg placeholder:text-muted"
          />
          <ConfirmButton
            label={item.next}
            confirm={`Retry ${product} on ${report.name}`}
            disabled={!reason.trim() || call.isPending}
            onConfirm={() =>
              call.mutate({
                path: `v1/environments/${encodeURIComponent(report.name)}/failed-targets/${encodeURIComponent(product)}/retry`,
                body: retryFailedTargetBody(
                  report.name,
                  expectedGeneration(report.lease),
                  product,
                  reason.trim(),
                ),
              })
            }
          />
        </>
      )}
      {call.outcome && <Notice tone={call.outcome.tone}>{call.outcome.text}</Notice>}
    </div>
  );
};
