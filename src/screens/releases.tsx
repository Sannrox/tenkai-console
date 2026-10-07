import { useState } from "react";
import type { ManagementLifecycleResult } from "../api/tenkai.gen";
import { useSession } from "../auth/session";
import { channelTable } from "../delivery/configuration";
import { useDelivery } from "../delivery/use-delivery";
import { isReleaseSpec, parsePublish, promoteBody, recallBody } from "../management/catalog";
import { refusesCredential, useManagementCall } from "../management/use-management";
import { Card, ConfirmButton, Notice } from "../ui/kit";

const th = "border-b border-line px-3.5 py-2 text-left font-medium whitespace-nowrap text-muted";

/**
 * The software catalog. Channels (decision 4D): the head each channel points
 * to and who follows it, read from environment inspects; below it, publish,
 * promote, and recall through the catalog lifecycle routes.
 */
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
      {token && <Catalog token={token} channels={table.channels} />}
    </>
  );
};

const field =
  "min-w-0 rounded-md border border-field bg-white/4 px-2.5 py-1.5 font-mono text-xs text-fg placeholder:text-muted";
const message = (result: ManagementLifecycleResult) => result.message;

const Catalog = ({ token, channels }: { token: string; channels: string[] }) => {
  const publish = useManagementCall(token, "fleet", message);
  const promote = useManagementCall(token, "fleet", message);
  const recall = useManagementCall(token, "fleet", message);
  const [manifest, setManifest] = useState("");
  const [signature, setSignature] = useState("");
  const [roots, setRoots] = useState("");
  const [release, setRelease] = useState("");
  const [channel, setChannel] = useState("");
  const pasted = Boolean(manifest && signature && roots);
  const parsed = pasted ? parsePublish(manifest, signature, roots) : undefined;
  const spec = release.trim();
  const target = channel.trim();

  if (!publish.allowed) {
    // The refusal that hid the controls stays readable.
    const refusal = [publish, promote, recall].find((call) =>
      refusesCredential(call.error),
    )?.outcome;
    return refusal ? (
      <div className="mt-[18px]">
        <Notice tone={refusal.tone}>{refusal.text}</Notice>
      </div>
    ) : null;
  }
  return (
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
      </div>
      <div className="mt-2 grid gap-1">
        {promote.outcome && <Notice tone={promote.outcome.tone}>{promote.outcome.text}</Notice>}
        {recall.outcome && <Notice tone={recall.outcome.tone}>{recall.outcome.text}</Notice>}
      </div>
    </>
  );
};
