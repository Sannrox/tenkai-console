import { useState } from "react";
import type {
  EnvironmentConfigChange,
  EnvironmentInspectReport,
  ManagementLifecycleResult,
} from "../api/tenkai.gen";
import { attributed, failureGroups, type Source } from "../delivery/attribution";
import { useDeliveryLists } from "../delivery/delivery-pages";
import {
  deliveryRows,
  endpointsLine,
  fetchDeliveries,
  ownerLine,
  ownerReach,
  statusOwners,
  unrouted,
} from "../delivery/owners";
import { useEnvironmentStatus } from "../delivery/use-delivery";
import { configCall } from "../management/environment-config";
import { useManagementCall } from "../management/use-management";
import { expectedGeneration } from "../plan/requests";
import { Button, Card, ConfirmButton, Notice } from "../ui/kit";
import { DeliveryFailures, Endpoints, MoreDeliveries, TONE } from "./notification-routing";

const field =
  "min-w-0 rounded-md border border-field bg-white/4 px-2.5 py-1.5 text-xs text-fg placeholder:text-muted";
const th = "border-b border-line px-3.5 py-2 text-left font-medium whitespace-nowrap text-muted";
const td = "border-b border-line px-3.5 py-2 align-top";

const COPY = {
  unrouted: "No owner and no webhooks",
  unavailable: "This server does not report webhook deliveries.",
  forbidden: "No access",
  empty: "none",
  loading: "Loading",
} as const;

/**
 * Environment owner, the server's reachability verdict for it and each
 * endpoint, the product owners its status reports, failing deliveries by
 * source and owner, and the raw webhook deliveries by URL. Lazily loaded with history. An owner change is
 * one request with a reason and the generation the form opened on; a lost
 * answer reads as unknown and is not resent. Webhooks keep their own editor
 * in the configuration sections.
 */
export const EnvironmentOwner = ({
  report,
  token,
}: {
  report: EnvironmentInspectReport;
  token: string;
}) => {
  const call = useManagementCall(
    token,
    `environment:${report.name}`,
    "management",
    (result: ManagementLifecycleResult) => result.message,
  );
  const allowed = call.allowed;
  const generation = expectedGeneration(report.lease);
  const send = (draft: number, reason: string, change: EnvironmentConfigChange) =>
    call.mutate(configCall(report.name, draft, reason, change));
  const [open, setOpen] = useState(false);
  const status = useEnvironmentStatus(token, report.name);
  const owners = status.data?.kind === "ok" ? statusOwners(status.data.value) : [];
  const reach = ownerReach(report.owner);
  // Owners this page knows: its own, and product owners from status rows.
  const ownerOf = ({ kind, name }: Source): string | undefined => {
    if (kind === "environment") {
      return name === report.name ? ownerLine(report.owner) : undefined;
    }
    const row =
      status.data?.kind === "ok"
        ? status.data.value.find((item) => item.product === name)
        : undefined;
    return kind === "product" && row ? row.owner?.trim() || "none" : undefined;
  };
  return (
    <section aria-label="Owner" className="min-w-0">
      <div className="mt-[18px] mb-1 flex items-center gap-2">
        <h2 className="m-0 text-[13px] font-semibold">Owner</h2>
        {allowed && (
          <Button variant="ghost" onClick={() => setOpen(!open)}>
            {open ? "Close" : "Edit"}
          </Button>
        )}
      </div>
      {unrouted(report) && (
        <p aria-label="Owner routing" className="m-0 text-xs text-warning">
          {COPY.unrouted}
        </p>
      )}
      <dl className="m-0 grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted">contact</dt>
        <dd className={`m-0 break-all ${report.owner ? "" : "text-muted"}`}>
          {ownerLine(report.owner)}
        </dd>
        <dt className="text-muted">endpoints</dt>
        <dd className={`m-0 break-all ${report.owner?.endpoints?.length ? "" : "text-muted"}`}>
          {endpointsLine(report.owner?.endpoints)}
        </dd>
        {reach && (
          <>
            <dt className="text-muted">reachability</dt>
            <dd aria-label="Owner reachability" className={`m-0 ${TONE[reach.tone]}`}>
              {reach.verdict}
            </dd>
          </>
        )}
        {owners.map((row) => (
          <div key={row.instance} className="contents">
            <dt className="truncate text-muted">{row.instance} owner</dt>
            <dd className={`m-0 break-all ${row.owner === "none" ? "text-muted" : ""}`}>
              {row.owner}
            </dd>
          </div>
        ))}
      </dl>
      {reach && reach.endpoints.length > 0 && <Endpoints rows={reach.endpoints} />}
      {allowed && open && (
        <Card className="mt-1 flex flex-wrap items-center gap-2 px-3.5 py-3 text-xs">
          <OwnerForm
            pending={call.isPending}
            generation={generation}
            send={send}
            current={report.owner?.contact}
          />
        </Card>
      )}
      {call.outcome && (
        <div className="mt-1">
          <Notice tone={call.outcome.tone}>{call.outcome.text}</Notice>
        </div>
      )}
      <Deliveries environment={report.name} token={token} ownerOf={ownerOf} />
    </section>
  );
};

const OwnerForm = ({
  pending,
  generation,
  send,
  current,
}: {
  pending: boolean;
  generation: number;
  send: (draft: number, reason: string, change: EnvironmentConfigChange) => void;
  current: string | undefined;
}) => {
  // The generation this draft started from; a refreshed report does not move it.
  const [draft] = useState(generation);
  const [contact, setContact] = useState(current ?? "");
  const [reason, setReason] = useState("");
  const ready = !pending && reason.trim() !== "";
  return (
    <>
      <input
        aria-label="Owner contact"
        placeholder="Owner contact"
        value={contact}
        onChange={(event) => setContact(event.target.value)}
        className={`${field} flex-1`}
      />
      <input
        aria-label="Owner reason"
        placeholder="Reason"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        className={`${field} flex-1`}
      />
      <ConfirmButton
        label="Set"
        confirm={`Set owner ${contact.trim()}`}
        disabled={!ready || !contact.trim()}
        onConfirm={() => send(draft, reason, { kind: "set_owner", contact: contact.trim() })}
      />
      {current !== undefined && (
        <ConfirmButton
          label="Clear"
          confirm="Clear the owner"
          disabled={!ready}
          onConfirm={() => send(draft, reason, { kind: "clear_owner" })}
        />
      )}
    </>
  );
};

/**
 * Raw deliveries, newest first. Read only; the server retries, not the
 * console. Further pages load on request and are never counted as complete
 * while a cursor remains.
 */
const Deliveries = ({
  environment,
  token,
  ownerOf,
}: {
  environment: string;
  token: string;
  ownerOf: (source: Source) => string | undefined;
}) => {
  const { lists, more, loadingMore } = useDeliveryLists(
    ["webhook-deliveries", environment, token],
    [environment],
    (key, cursor) => fetchDeliveries(key, token, fetch, cursor),
  );
  const list = lists?.[0];
  const load = list?.load;
  const partial = load?.kind === "ok" && list?.next !== undefined ? load.value.length : undefined;
  let body;
  if (load === undefined) {
    body = <p className="m-0 px-3.5 py-3 text-xs text-muted">{COPY.loading}</p>;
  } else if (load.kind === "unavailable" || load.kind === "forbidden") {
    body = <p className="m-0 px-3.5 py-3 text-xs text-muted">{COPY[load.kind]}</p>;
  } else if (load.kind === "error") {
    body = (
      <p role="alert" className="m-0 px-3.5 py-3 text-xs text-danger">
        {load.message}
      </p>
    );
  } else if (load.value.length === 0) {
    body = <p className="m-0 px-3.5 py-3 text-xs text-muted">{COPY.empty}</p>;
  } else {
    body = (
      <table aria-label="Webhook deliveries" className="w-full border-collapse text-xs">
        <thead>
          <tr>
            <th className={th}>URL</th>
            <th className={th}>Event</th>
            <th className={th}>State</th>
            <th className={th}>Attempts</th>
            <th className={th}>Next attempt</th>
            <th className={th}>Last error</th>
          </tr>
        </thead>
        <tbody>
          {deliveryRows(load.value).map((row) => (
            <tr key={row.id} className="[&:last-child>td]:border-b-0">
              <td className={`${td} font-mono whitespace-nowrap`}>{row.url}</td>
              <td className={`${td} font-mono`}>{row.event}</td>
              <td className={`${td} ${TONE[row.tone]}`}>{row.state}</td>
              <td className={`${td} font-mono`}>{row.attempts}</td>
              <td className={`${td} font-mono whitespace-nowrap`}>{row.next}</td>
              <td className={`${td} min-w-48 break-all`}>{row.error}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  return (
    <>
      {load?.kind === "ok" && attributed(load.value) && (
        <DeliveryFailures groups={failureGroups(load.value, ownerOf)} partial={partial} />
      )}
      <h3 className="mt-3 mb-1 text-xs font-semibold">Webhook deliveries</h3>
      <Card className="overflow-x-auto">{body}</Card>
      {partial !== undefined && (
        <MoreDeliveries
          shown={partial}
          failed={list?.moreFailed === true}
          loading={loadingMore}
          onMore={more}
        />
      )}
    </>
  );
};

export default EnvironmentOwner;
