import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { request } from "../api/http";
import type {
  ChangeEventPage,
  EnvironmentInspectReport,
  ManagementLifecycleResult,
} from "../api/tenkai.gen";
import { type DeliveryCapability, isRefused, useSession } from "../auth/session";
import { channelMatrix, fleetTableRows, type FleetTableRow } from "../delivery/configuration";
import { cohortNames, recallEvents } from "../delivery/exposure";
import { useDelivery } from "../delivery/use-delivery";
import { isReleaseSpec, parsePublish, promoteBody, recallBody } from "../management/catalog";
import {
  failure,
  newRequestId,
  refusesCredential,
  useManagementCall,
  type Outcome,
} from "../management/use-management";
import { expectedGeneration, holdBody, releaseHoldBody } from "../plan/requests";
import { Card, ConfirmButton, Notice } from "../ui/kit";
import { td } from "../ui/posture";
import { Compatibility } from "./compatibility";
import { Migrations } from "./migrations";

const th = "border-b border-line px-3.5 py-2 text-left font-medium whitespace-nowrap text-muted";

/**
 * The software catalog. Channels (decision 4D): the head each channel points
 * to, from the channel catalog; below it, a release's compatibility per
 * environment, publish, promote, recall, and package migrations.
 */
export const Releases = () => {
  const token = useSession((state) => state.session?.accessToken);
  const delivery = useDelivery(token);
  const table = channelMatrix(delivery.channels);
  const names = fleetTableRows(delivery.fleet, delivery.list).map((row) => row.name);
  const failed = delivery.channelsError ?? delivery.error;

  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="m-0 text-lg font-semibold">Releases</h1>
        <span className="text-xs text-muted">
          {failed
            ? failed.message
            : delivery.channelsLoading
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
                  const cell = table.cell(product, channel);
                  return (
                    <td key={channel} className="border-b border-l border-line px-3.5 py-2">
                      {cell ? (
                        <span className="font-mono">{cell.version}</span>
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
      {token && <Compatibility token={token} environments={names} />}
      {token && <Catalog token={token} channels={table.channels} />}
      {token && (
        <RecallFollow token={token} fleet={fleetTableRows(delivery.fleet, delivery.list)} />
      )}
      {token && <Migrations token={token} environments={names} />}
    </>
  );
};

const field =
  "min-w-0 rounded-md border border-field bg-white/4 px-2.5 py-1.5 font-mono text-xs text-fg placeholder:text-muted";
const message = (result: ManagementLifecycleResult) => result.message;

const Catalog = ({ token, channels }: { token: string; channels: string[] }) => {
  const publish = useManagementCall(token, "fleet", "publish", message);
  const promote = useManagementCall(token, "fleet", "publish", message);
  const recall = useManagementCall(token, "fleet", "management", message);
  const [manifest, setManifest] = useState("");
  const [signature, setSignature] = useState("");
  const [roots, setRoots] = useState("");
  const [release, setRelease] = useState("");
  const [channel, setChannel] = useState("");
  const pasted = Boolean(manifest && signature && roots);
  const parsed = pasted ? parsePublish(manifest, signature, roots) : undefined;
  const spec = release.trim();
  const target = channel.trim();
  const publishRefusal = [publish, promote].find((call) => refusesCredential(call.error))?.outcome;
  const recallRefusal = refusesCredential(recall.error) ? recall.outcome : undefined;

  if (!publish.allowed && !recall.allowed) {
    const refusal = publishRefusal ?? recallRefusal;
    return refusal ? (
      <div className="mt-[18px]">
        <Notice tone={refusal.tone}>{refusal.text}</Notice>
      </div>
    ) : null;
  }
  return (
    <>
      {publish.allowed ? (
        <>
          <h2 className="mt-[18px] mb-2 text-[13px] font-semibold">Publish</h2>
          <div className="grid gap-3 md:grid-cols-3">
            <textarea
              rows={6}
              aria-label="Release manifest"
              placeholder="Paste tenkai.toml"
              value={manifest}
              onChange={(event) => setManifest(event.target.value)}
              className={field}
            />
            <textarea
              rows={6}
              aria-label="Release signature"
              placeholder="Paste the release signature JSON"
              value={signature}
              onChange={(event) => setSignature(event.target.value)}
              className={field}
            />
            <textarea
              rows={6}
              aria-label="Release trust roots"
              placeholder="Paste the release trust-roots TOML"
              value={roots}
              onChange={(event) => setRoots(event.target.value)}
              className={field}
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ConfirmButton
              label="Publish"
              confirm={`Publish ${typeof parsed === "object" ? parsed.release : ""}`}
              disabled={typeof parsed !== "object" || publish.isPending}
              onConfirm={() => {
                if (typeof parsed === "object") {
                  publish.mutate({ path: "v1/releases", body: parsed.body });
                }
              }}
            />
            {typeof parsed === "string" && <Notice tone="bad">{parsed}</Notice>}
            {publish.outcome && <Notice tone={publish.outcome.tone}>{publish.outcome.text}</Notice>}
          </div>
        </>
      ) : (
        publishRefusal && (
          <div className="mt-[18px]">
            <Notice tone={publishRefusal.tone}>{publishRefusal.text}</Notice>
          </div>
        )
      )}

      {(publish.allowed || recall.allowed) && (
        <>
          <h2 className="mt-[18px] mb-2 text-[13px] font-semibold">Promote or recall</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label="Release"
              placeholder="product@version"
              value={release}
              onChange={(event) => setRelease(event.target.value)}
              className={field}
            />
            <input
              aria-label="Channel"
              placeholder="Channel"
              list="catalog-channels"
              value={channel}
              onChange={(event) => setChannel(event.target.value)}
              className={field}
            />
            <datalist id="catalog-channels">
              {channels.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            {publish.allowed && (
              <ConfirmButton
                label="Promote"
                confirm={`Promote ${spec} to ${target}`}
                disabled={!isReleaseSpec(spec) || !target || promote.isPending}
                onConfirm={() =>
                  promote.mutate({
                    path: `v1/channels/${encodeURIComponent(target)}/promote`,
                    body: promoteBody(spec),
                  })
                }
              />
            )}
            {recall.allowed && (
              <ConfirmButton
                label="Recall"
                confirm={`Recall ${spec}`}
                disabled={!isReleaseSpec(spec) || recall.isPending}
                onConfirm={() =>
                  recall.mutate({
                    path: `v1/releases/${encodeURIComponent(spec)}/recall`,
                    body: recallBody,
                  })
                }
              />
            )}
          </div>
          <div className="mt-2 grid gap-1">
            {promote.outcome && <Notice tone={promote.outcome.tone}>{promote.outcome.text}</Notice>}
            {recall.outcome && <Notice tone={recall.outcome.tone}>{recall.outcome.text}</Notice>}
          </div>
        </>
      )}
    </>
  );
};

/**
 * Pick A (#41): recall proposal state from change events, and a cohort table
 * whose Stop/Resume are environment holds so the table shows server state.
 */
const RecallFollow = ({ token, fleet }: { token: string; fleet: FleetTableRow[] }) => {
  const events = useQuery({
    queryKey: ["events", token],
    queryFn: () => request<ChangeEventPage>("v1/events?limit=100", { token }),
    retry: false,
  });
  const recalled = events.data ? recallEvents(events.data.events) : [];
  const [cohort, setCohort] = useState("");
  const names = cohortNames(cohort);
  const byName = new Map(fleet.map((row) => [row.name, row]));
  const mutate = useSession((state) => !isRefused(state.refused, "fleet", "management"));
  return (
    <>
      <h2 className="mt-[18px] mb-2 text-[13px] font-semibold">Recall follow-through</h2>
      <p className="m-0 mb-2 text-xs text-muted">
        {events.error
          ? events.error.message
          : recalled.length === 0
            ? "no recall events"
            : recalled
                .slice(0, 8)
                .map((event) => `${event.resource} ${new Date(event.occurred_at).toISOString()}`)
                .join(" · ")}
      </p>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input
          aria-label="Cohort"
          placeholder="Cohort"
          value={cohort}
          onChange={(event) => setCohort(event.target.value)}
          className={field}
        />
      </div>
      {names.length > 0 && (
        <Card className="overflow-x-auto">
          <table aria-label="Recall cohort" className="w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className={th}>Cohort</th>
                <th className={th}>Environment</th>
                <th className={th}>State</th>
                <th className={th}>Done</th>
                {mutate && <th className={th} />}
              </tr>
            </thead>
            <tbody>
              {names.map((name, index) => {
                const row = byName.get(name);
                const state = row?.status ?? "unknown";
                const done = state === "current" ? "yes" : "no";
                return (
                  <tr key={name}>
                    <td className={td}>{index + 1}</td>
                    <td className={td}>{name}</td>
                    <td className={td}>{state}</td>
                    <td className={td}>{done}</td>
                    {mutate && (
                      <td className={td}>
                        <CohortHold token={token} environment={name} held={state === "held"} />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
};

const CohortHold = ({
  token,
  environment,
  held,
}: {
  token: string;
  environment: string;
  held: boolean;
}) => {
  const hold = useEnvironmentHold(token, environment);
  if (!hold.allowed) {
    return hold.outcome ? <Notice tone={hold.outcome.tone}>{hold.outcome.text}</Notice> : null;
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {held ? (
        <ConfirmButton
          label="Resume"
          confirm={`Resume ${environment}`}
          disabled={hold.isPending}
          onConfirm={() => hold.mutate("resume")}
        />
      ) : (
        <ConfirmButton
          label="Stop"
          confirm={`Stop ${environment}`}
          disabled={hold.isPending}
          onConfirm={() => hold.mutate("stop")}
        />
      )}
      {hold.outcome && <Notice tone={hold.outcome.tone}>{hold.outcome.text}</Notice>}
    </div>
  );
};

const useEnvironmentHold = (token: string, environment: string) => {
  const queryClient = useQueryClient();
  const capability: DeliveryCapability = "management";
  const allowed = useSession((state) => !isRefused(state.refused, "fleet", capability));
  const refuse = useSession((state) => state.refuse);
  const mutation = useMutation({
    mutationFn: async (action: "stop" | "resume") => {
      const report = await request<EnvironmentInspectReport>(
        `v1/environments/${encodeURIComponent(environment)}`,
        { token },
      );
      const generation = expectedGeneration(report.lease);
      const path =
        action === "stop"
          ? `v1/environments/${encodeURIComponent(environment)}/hold`
          : `v1/environments/${encodeURIComponent(environment)}/hold/release`;
      const body =
        action === "stop"
          ? holdBody(environment, generation, "recall follow-through")
          : releaseHoldBody(environment, generation);
      return request<ManagementLifecycleResult>(path, {
        token,
        method: "POST",
        body,
        requestId: newRequestId(),
      });
    },
    onError: (error) => {
      if (refusesCredential(error)) {
        refuse(token, "fleet", capability);
      }
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["environment", environment] }),
        queryClient.invalidateQueries({ queryKey: ["environments"] }),
        queryClient.invalidateQueries({ queryKey: ["fleet"] }),
        queryClient.invalidateQueries({ queryKey: ["events"] }),
      ]),
  });
  const outcome: Outcome | undefined = mutation.isSuccess
    ? { tone: "ok", text: mutation.data.message }
    : mutation.error
      ? failure(mutation.error, capability)
      : undefined;
  return { ...mutation, allowed, outcome };
};
