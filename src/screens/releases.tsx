import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useState } from "react";
import { request } from "../api/http";
import type {
  ChangeEventPage,
  EnvironmentInspectReport,
  ManagementLifecycleResult,
} from "../api/tenkai.gen";
import { type DeliveryCapability, isRefused, useSession } from "../auth/session";
import { channelMatrix, type FleetTableRow } from "../delivery/configuration";
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
import { ActionsMenu, Button, Card, ConfirmButton, Notice, ObjectPage } from "../ui/kit";
import { td } from "../ui/posture";
import { ProductLink, ReleaseLink } from "./object-link";
import { releaseSpec } from "./objects";

const RecallDetail = lazy(() => import("./recall-detail"));

const th = "border-b border-line px-3.5 py-2 text-left font-medium whitespace-nowrap text-muted";

/**
 * The software catalog: product by channel heads. Writes and catalog tools
 * live on the product, release, environment, or Exposure object they name.
 */
export const Releases = () => {
  const token = useSession((state) => state.session?.accessToken);
  const queryClient = useQueryClient();
  const delivery = useDelivery(token);
  const table = channelMatrix(delivery.channels);
  const failed = delivery.channelsError ?? delivery.error;

  return (
    <ObjectPage
      name="Releases"
      status={
        failed
          ? "The channel list was not loaded."
          : delivery.channelsLoading
            ? "Loading"
            : `${table.channels.length} ${table.channels.length === 1 ? "channel" : "channels"}`
      }
      actions={
        failed ? (
          <ActionsMenu
            needed
            items={[
              {
                label: "Retry",
                onClick: () => {
                  void queryClient.invalidateQueries({ queryKey: ["channels", token] });
                  void queryClient.invalidateQueries({ queryKey: ["fleet", token] });
                  void queryClient.invalidateQueries({ queryKey: ["environments", token] });
                },
              },
            ]}
          />
        ) : undefined
      }
    >
      {table.products.length === 0 ? (
        <p className="m-0 text-xs text-muted">
          {delivery.channelsLoading ? "Loading" : "No products yet."}
        </p>
      ) : (
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
                  <td className="border-b border-line px-3.5 py-2 font-semibold">
                    <ProductLink product={product} />
                  </td>
                  {table.channels.map((channel) => {
                    const cell = table.cell(product, channel);
                    return (
                      <td key={channel} className="border-b border-l border-line px-3.5 py-2">
                        {cell ? (
                          <ReleaseLink spec={releaseSpec(product, cell.version)}>
                            {cell.version}
                          </ReleaseLink>
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
      )}
    </ObjectPage>
  );
};

const field =
  "min-w-0 rounded-md border border-field bg-white/4 px-2.5 py-1.5 font-mono text-xs text-fg placeholder:text-muted";
const message = (result: ManagementLifecycleResult) => result.message;

export type CatalogMode = "publish" | "promote" | "recall";

export const Catalog = ({
  token,
  channels,
  product,
  mode,
}: {
  token: string;
  channels: string[];
  product: string;
  mode: CatalogMode;
}) => {
  const publish = useManagementCall(token, "fleet", "publish", message);
  const promote = useManagementCall(token, "fleet", "publish", message);
  const recall = useManagementCall(token, "fleet", "management", message);
  const [manifest, setManifest] = useState("");
  const [signature, setSignature] = useState("");
  const [roots, setRoots] = useState("");
  const [release, setRelease] = useState(`${product}@`);
  const [channel, setChannel] = useState("");
  const pasted = Boolean(manifest && signature && roots);
  const parsed = pasted ? parsePublish(manifest, signature, roots) : undefined;
  const spec = release.trim();
  const target = channel.trim();
  const publishRefusal = [publish, promote].find((call) => refusesCredential(call.error))?.outcome;
  const recallRefusal = refusesCredential(recall.error) ? recall.outcome : undefined;

  const showPublish = mode === "publish" && publish.allowed;
  const showPromote = mode === "promote" && publish.allowed;
  const showRecall = mode === "recall" && recall.allowed;
  if (!showPublish && !showPromote && !showRecall) {
    const refusal = publishRefusal ?? recallRefusal;
    return refusal ? (
      <div className="mt-[18px]">
        <Notice tone={refusal.tone}>{refusal.text}</Notice>
      </div>
    ) : null;
  }
  return (
    <>
      {showPublish ? (
        <>
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

      {(showPromote || showRecall) && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label="Release"
              placeholder="product@version"
              value={release}
              onChange={(event) => setRelease(event.target.value)}
              className={field}
            />
            {showPromote && (
              <>
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
              </>
            )}
            {showRecall && (
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
 * Pick A (#41): recalled releases from change events, each with a Detail that
 * reads the recorded recall, and a cohort table whose Stop/Resume are
 * environment holds so the table shows server state.
 */
export const RecallFollow = ({
  token,
  fleet,
  product,
}: {
  token: string;
  fleet: FleetTableRow[];
  product?: string;
}) => {
  const events = useQuery({
    queryKey: ["events", token],
    queryFn: () => request<ChangeEventPage>("v1/events?limit=100", { token }),
    retry: false,
  });
  const recalled = events.data
    ? [
        ...new Set(
          recallEvents(events.data.events)
            .map((event) => event.resource)
            .filter((release) => product === undefined || release.startsWith(`${product}@`)),
        ),
      ]
    : [];
  const [selected, setSelected] = useState<string>();
  const [cohort, setCohort] = useState("");
  const names = cohortNames(cohort);
  const byName = new Map(fleet.map((row) => [row.name, row]));
  const mutate = useSession((state) => !isRefused(state.refused, "fleet", "management"));
  return (
    <>
      <h2 className="mt-[18px] mb-2 text-[13px] font-semibold">Recall follow-through</h2>
      {events.error ? (
        <p className="m-0 mb-2 text-xs text-muted">Recalls could not be read.</p>
      ) : events.data === undefined ? null : recalled.length === 0 ? (
        <p className="m-0 mb-2 text-xs text-muted">No recalls.</p>
      ) : (
        <ul aria-label="Recalled releases" className="m-0 mb-2 flex list-none flex-wrap gap-2 p-0">
          {recalled.slice(0, 8).map((release) => (
            <li key={release}>
              <Button
                variant={selected === release ? "primary" : "plain"}
                aria-label={`Detail ${release}`}
                aria-pressed={selected === release}
                onClick={() => setSelected(selected === release ? undefined : release)}
              >
                <span className="font-mono">{release}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
      {selected !== undefined && (
        <Suspense fallback={null}>
          <RecallDetail token={token} release={selected} />
        </Suspense>
      )}
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
