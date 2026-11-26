import { Link } from "@tanstack/react-router";
import type { TickReport } from "../api/tenkai.gen";
import { useSession } from "../auth/session";
import { fleetTableRows } from "../delivery/configuration";
import { useAttention } from "../delivery/use-attention";
import { tickLines, tickSummary } from "../management/reconcile";
import { UNKNOWN_OUTCOME, useManagementCall } from "../management/use-management";
import { ActionsMenu, ConfirmButton, Notice, ObjectPage, headingCount } from "../ui/kit";
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
  const incomplete = attention.failed.length > 0;
  const tick = useManagementCall<TickReport>(token ?? "", "fleet", "management", tickSummary);
  const unknown = tick.outcome?.tone === "unknown";
  const count = attention.error
    ? attention.error.message
    : attention.loading
      ? "Loading"
      : unknown
        ? headingCount(`${rows.length} environments`, "unknown")
        : incomplete
          ? headingCount(`${rows.length} environments`, "incomplete")
          : attention.fleet && attention.fleet.environments_behind > 0
            ? `${rows.length} environments, ${attention.fleet.environments_behind} behind`
            : `${rows.length} environments, all current`;
  const showActions = token !== undefined && (incomplete || tick.allowed || unknown);
  return (
    <ObjectPage
      name="Home"
      status={count}
      actions={
        showActions ? (
          <ActionsMenu
            needed={incomplete || unknown}
            status={unknown ? UNKNOWN_OUTCOME : undefined}
            items={incomplete ? [{ label: "Retry", onClick: attention.retry }] : undefined}
          >
            {tick.allowed && (
              <ConfirmButton
                label="Reconcile"
                confirm="Run one reconcile tick"
                disabled={tick.isPending}
                onConfirm={() => tick.mutate({ path: "v1/reconcile" })}
              />
            )}
          </ActionsMenu>
        ) : undefined
      }
    >
      {tick.outcome && tick.outcome.tone !== "unknown" && (
        <Notice tone={tick.outcome.tone}>{tick.outcome.text}</Notice>
      )}
      {tick.data &&
        tickLines(tick.data).map((line) => (
          <div key={line.environment} className="text-xs">
            <b className="font-semibold">{line.environment}</b>{" "}
            <span className={TONE[line.tone]}>{line.text}</span>
          </div>
        ))}
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
    </ObjectPage>
  );
};
