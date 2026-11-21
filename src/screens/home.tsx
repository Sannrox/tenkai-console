import { Link } from "@tanstack/react-router";
import type { TickReport } from "../api/tenkai.gen";
import { useSession } from "../auth/session";
import { fleetTableRows } from "../delivery/configuration";
import { useAttention } from "../delivery/use-attention";
import { tickLines, tickSummary } from "../management/reconcile";
import { refusesCredential, useManagementCall } from "../management/use-management";
import { Button, ConfirmButton, Notice } from "../ui/kit";
import { objectKey, objectTypeLabel, useSaved, type SavedObject } from "../ui/saved";
import { AttentionList } from "./attention-list";
import { Delivery } from "./delivery";
import { SavedLink } from "./object-link";

const TONE = { ok: "text-ok", warn: "text-warning", bad: "text-danger" } as const;
const TOP = 5;

const SavedSection = ({
  title,
  items,
}: {
  title: "Pinned" | "Recent";
  items: readonly SavedObject[];
}) => (
  <>
    <h2 className="mt-[18px] mb-2 text-[13px] font-semibold">{title}</h2>
    {items.length === 0 ? (
      <p className="m-0 text-xs text-muted">None yet.</p>
    ) : (
      <ul aria-label={title} className="m-0 list-none p-0">
        {items.map((item) => (
          <li key={objectKey(item)} className="mb-1 text-[13px]">
            <SavedLink item={item} />
            <span className="ml-2 text-xs text-muted">{objectTypeLabel(item.kind)}</span>
          </li>
        ))}
      </ul>
    )}
  </>
);

/** Signed-in landing: fleet counts, top attention, pinned, recent, reconcile. */
export const Home = () => {
  const token = useSession((state) => state.session?.accessToken);
  const attention = useAttention(token);
  const pins = useSaved((state) => state.pins);
  const recent = useSaved((state) => state.recent);
  const rows = fleetTableRows(attention.fleet, attention.list);
  const top = attention.items.slice(0, TOP);
  const more = attention.items.length - top.length;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="m-0 text-lg font-semibold">Home</h1>
        <span className="text-xs text-muted">
          {attention.error
            ? attention.error.message
            : attention.loading
              ? "Loading"
              : attention.fleet && attention.fleet.environments_behind > 0
                ? `${rows.length} environments, ${attention.fleet.environments_behind} behind`
                : `${rows.length} environments, all current`}
        </span>
        {token !== undefined && <Reconcile token={token} />}
      </div>
      {attention.failed.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-warning">
          <span>The list may be incomplete.</span>
          <Button onClick={attention.retry}>Retry</Button>
        </div>
      )}
      {!attention.loading && !attention.error && <Delivery rows={rows} fleet={attention.fleet} />}
      {!attention.loading && !attention.error && rows.length > 0 && (
        <>
          <h2 className="mt-[18px] mb-2 text-[13px] font-semibold">Attention</h2>
          <AttentionList items={top} />
          {more > 0 && (
            <Link to="/attention" className="mt-2 inline-block text-xs text-fg">
              {more} more
            </Link>
          )}
        </>
      )}
      <SavedSection title="Pinned" items={pins} />
      <SavedSection title="Recent" items={recent} />
    </>
  );
};

/**
 * Requests one reconcile tick and shows the server's report. The environment
 * reads refresh once it settles; a lost response stays unknown until then.
 */
const Reconcile = ({ token }: { token: string }) => {
  const tick = useManagementCall<TickReport>(token, "fleet", "management", tickSummary);
  const refused = refusesCredential(tick.error);
  if (!tick.allowed && !refused) {
    return null;
  }
  return (
    <div className="ml-auto flex flex-col items-end gap-1 text-xs">
      {tick.allowed && (
        <div className="flex gap-2">
          <ConfirmButton
            label="Reconcile"
            confirm="Run one reconcile tick"
            disabled={tick.isPending}
            onConfirm={() => tick.mutate({ path: "v1/reconcile" })}
          />
        </div>
      )}
      {tick.outcome && <Notice tone={tick.outcome.tone}>{tick.outcome.text}</Notice>}
      {tick.data &&
        tickLines(tick.data).map((line) => (
          <div key={line.environment}>
            <b className="font-semibold">{line.environment}</b>{" "}
            <span className={TONE[line.tone]}>{line.text}</span>
          </div>
        ))}
    </div>
  );
};
