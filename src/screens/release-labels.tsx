import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { ManagementLifecycleResult } from "../api/tenkai.gen";
import { useAuthSession } from "../auth/identity";
import { isReleaseSpec } from "../management/catalog";
import { fetchLabels, labelLine, releaseLabelCall, releaseLabelsPath } from "../management/labels";
import { useManagementCall } from "../management/use-management";
import { ConfirmButton, Notice } from "../ui/kit";

const field =
  "min-w-0 rounded-md border border-field bg-white/4 px-2.5 py-1.5 font-mono text-xs text-fg placeholder:text-muted";
const COPY = { unavailable: "This server does not report labels.", forbidden: "No access" };
const message = (result: ManagementLifecycleResult) => result.message;

/**
 * Labels on one release, named as `product@version`. Writes carry no
 * generation, so the last write wins; each is one confirmed request with a
 * reason, never retried. The editor is hidden without management.
 */
const ReleaseLabels = ({ token }: { token: string }) => {
  const call = useManagementCall(token, "fleet", "management", message);
  const me = useAuthSession(token);
  const [release, setRelease] = useState("");
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const spec = release.trim();
  const valid = isReleaseSpec(spec);
  const query = useQuery({
    queryKey: ["release-labels", spec, token],
    queryFn: () => fetchLabels(releaseLabelsPath(spec), token),
    enabled: valid,
    retry: false,
  });
  const load = valid ? query.data : undefined;
  const grants = me.data?.capabilities;
  const permitted =
    call.allowed &&
    load?.kind === "ok" &&
    !me.isPending &&
    (grants === undefined || grants.includes("management"));
  const ready = !call.isPending && key.trim() !== "" && reason.trim() !== "";
  const send = (next?: string) =>
    call.mutate(releaseLabelCall(spec, reason, key, next), {
      onSettled: () => void query.refetch(),
    });
  return (
    <section aria-label="Release labels">
      <h2 className="mt-[18px] mb-2 text-[13px] font-semibold">Release labels</h2>
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label="Labelled release"
          placeholder="product@version"
          value={release}
          onChange={(event) => setRelease(event.target.value)}
          className={field}
        />
        {valid && (
          <p aria-label="Release labels configured" className="m-0 text-xs break-all text-muted">
            {load === undefined
              ? "Loading"
              : load.kind === "ok"
                ? labelLine(load.labels)
                : load.kind === "error"
                  ? load.message
                  : COPY[load.kind]}
          </p>
        )}
      </div>
      {permitted && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            aria-label="Release label key"
            placeholder="Label key"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            className={field}
          />
          <input
            aria-label="Release label value"
            placeholder="Label value"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className={field}
          />
          <input
            aria-label="Release label reason"
            placeholder="Reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className={`${field} flex-1`}
          />
          <ConfirmButton
            label="Set"
            confirm={`Set ${spec} label ${key.trim()}=${value.trim()}`}
            disabled={!ready || !value.trim()}
            onConfirm={() => send(value)}
          />
          <ConfirmButton
            label="Clear"
            confirm={`Clear ${spec} label ${key.trim()}`}
            disabled={!ready}
            onConfirm={() => send()}
          />
          <span className="text-xs text-muted">Last write wins</span>
        </div>
      )}
      {call.outcome && (
        <div className="mt-2">
          <Notice tone={call.outcome.tone}>{call.outcome.text}</Notice>
        </div>
      )}
    </section>
  );
};

export default ReleaseLabels;
