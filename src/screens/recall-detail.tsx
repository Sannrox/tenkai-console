import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { ManagementLifecycleResult } from "../api/tenkai.gen";
import { useAuthSession } from "../auth/identity";
import { at } from "../delivery/promotion-policies";
import {
  environmentRows,
  exclusionsFor,
  fetchRecall,
  fetchRecallRanges,
  keptEnvironments,
  measuredLine,
  parseEnvironments,
  rangeLine,
  recallActor,
  recordedBeforeMeasures,
  remainingInScope,
  removalTotals,
  showsScope,
  widenBody,
  widenOutcome,
  widenPath,
  wideningLine,
  type EnvironmentRow,
  type RecallView,
} from "../delivery/recall";
import { useManagementCall } from "../management/use-management";
import { Card, ConfirmButton, Notice } from "../ui/kit";
import { parseReleaseSpec } from "./objects";

const LOAD_TEXT = {
  "not-recalled": "Not recalled.",
  unavailable: "This server does not report recall detail.",
  forbidden: "No access",
} as const;

const field =
  "min-w-0 rounded-md border border-field bg-white/4 px-2.5 py-1.5 font-mono text-xs text-fg placeholder:text-muted";
const th = "border-b border-line py-1.5 pr-2.5 text-left font-medium text-muted";
const td = "border-b border-line py-1.5 pr-2.5 align-top whitespace-normal";

const message = (result: ManagementLifecycleResult) => result.message;

/**
 * One recorded recall: a compact header, then one environment table as the
 * recall. Limited removal shows a Scope column and an audited widen. Range
 * exclusions are values. A lost widen is unknown and is never resent.
 */
export const RecallDetail = ({ token, release }: { token: string; release: string }) => {
  const query = useQuery({
    queryKey: ["recall", token, release],
    queryFn: () => fetchRecall(release, token),
    retry: false,
  });
  const product = parseReleaseSpec(release)?.product;
  const ranges = useQuery({
    queryKey: ["recall-ranges", token, product],
    queryFn: () => fetchRecallRanges(product ?? "", token),
    enabled: product !== undefined,
    retry: false,
  });
  const load = query.data;
  return (
    <section aria-label="Recall detail" className="mb-2">
      {load === undefined ? null : load.kind === "ok" ? (
        <Recall
          token={token}
          view={load.value}
          exclusions={exclusionsFor(load.value, ranges.data ?? [])}
        />
      ) : (
        <p className="m-0 text-xs text-muted">
          {load.kind === "error" ? load.message : LOAD_TEXT[load.kind]}
        </p>
      )}
    </section>
  );
};

const Recall = ({
  token,
  view,
  exclusions,
}: {
  token: string;
  view: RecallView;
  exclusions: ReturnType<typeof exclusionsFor>;
}) => {
  const rows = environmentRows(view);
  const left = remainingInScope(rows);
  const kept = keptEnvironments(rows);
  const before = recordedBeforeMeasures(view);
  const totals = before ? undefined : removalTotals(rows);
  const measured = measuredLine(view);
  const failing = view.failing_instances ?? [];
  const counted = rows.some((row) => row.counts);
  const scoped = showsScope(rows);
  const actor = recallActor(view);
  const when = view.recalled_at === undefined ? undefined : at(view.recalled_at);
  const who = when === undefined ? actor : `${actor} at ${when}`;
  const header = [view.release, who, view.reason].filter(Boolean).join(" · ");
  return (
    <Card className="px-3.5 py-3 text-xs">
      <p aria-label="Recall" className="m-0">
        <span className="font-mono">{view.release}</span>
        {header.slice(view.release.length)}
      </p>
      {measured !== undefined && (
        <p aria-label="Measured" className="mt-1 mb-0">
          {measured}
        </p>
      )}
      {before && (
        <p className="mt-1 mb-0 text-muted">
          not recorded, recalled before this server kept measures
        </p>
      )}
      {failing.length > 0 && (
        <p aria-label="Failing instances" className="mt-1 mb-0 font-mono">
          {failing.join(", ")}
        </p>
      )}
      <p aria-label="Range" className="mt-1 mb-0">
        {rangeLine(view, exclusions)}
      </p>
      {rows.length > 0 && (
        <table aria-label="Environments" className="mt-2 w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className={th}>Environment</th>
              {scoped && <th className={th}>Scope</th>}
              {counted && <th className={th}>Removed</th>}
              <th className={th}>Still running</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <EnvironmentCells
                key={row.environment}
                row={row}
                scoped={scoped}
                counted={counted}
                before={before}
              />
            ))}
          </tbody>
        </table>
      )}
      <p
        aria-label="Removal"
        className={`mt-2 mb-0 ${left.length === 0 ? "text-ok" : "text-warning"}`}
      >
        {left.length === 0
          ? "complete, no instance runs it"
          : scoped
            ? `${left.length} of ${rows.filter((row) => row.scope !== "keep").length} environments still in removal`
            : `in progress, ${left.length} ${left.length === 1 ? "environment" : "environments"} left`}
        {totals !== undefined && ` · ${totals.done} of ${totals.total} instances removed`}
        {kept.length > 0 &&
          `. ${kept.join(", ")} ${kept.length === 1 ? "is" : "are"} recalled, removal not in scope.`}
      </p>
      {(view.widenings ?? []).length > 0 && (
        <p aria-label="History" className="mt-2 mb-0">
          History {(view.widenings ?? []).map(wideningLine).join("; ")}
        </p>
      )}
      {view.removal_scope !== undefined && <Widen token={token} release={view.release} />}
    </Card>
  );
};

const EnvironmentCells = ({
  row,
  scoped,
  counted,
  before,
}: {
  row: EnvironmentRow;
  scoped: boolean;
  counted: boolean;
  before: boolean;
}) => (
  <tr className="[&:last-child>td]:border-b-0">
    <td className={td}>{row.environment}</td>
    {scoped && (
      <td className={`${td} ${row.scope === "keep" ? "text-warning" : ""}`}>{row.scope}</td>
    )}
    {counted && (
      <td className={`${td} font-mono ${before ? "text-muted" : ""}`}>
        {row.counts === undefined
          ? ""
          : before
            ? "not recorded"
            : `${row.counts.done} of ${row.counts.total}`}
      </td>
    )}
    <td className={`${td} font-mono`}>
      {row.instances.length === 0 ? "none" : row.instances.join(", ")}
    </td>
  </tr>
);

/**
 * Append environments or cover the fleet. Offered only when the recall named
 * a removal list and `/v1/auth/me` grants management. Each confirmed click
 * is one request.
 */
const Widen = ({ token, release }: { token: string; release: string }) => {
  const call = useManagementCall(token, "fleet", "management", message);
  const me = useAuthSession(token);
  const permitted = call.allowed && me.data?.capabilities.includes("management") === true;
  const [environments, setEnvironments] = useState("");
  const [reason, setReason] = useState("");
  const named = parseEnvironments(environments);
  const outcome = call.isSuccess
    ? widenOutcome(undefined)
    : call.error
      ? widenOutcome(call.error)
      : undefined;
  if (!permitted) {
    return null;
  }
  return (
    <div aria-label="Widen removal" role="group" className="mt-2 grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label="Add to removal"
          placeholder="prod"
          value={environments}
          onChange={(event) => setEnvironments(event.target.value)}
          className={`${field} w-28`}
        />
        <input
          aria-label="Reason"
          placeholder="reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className={`${field} min-w-40 flex-1`}
        />
        <ConfirmButton
          label="Widen removal"
          confirm={`Widen removal of ${release} with ${named.join(", ")}`}
          disabled={named.length === 0 || reason.trim() === "" || call.isPending}
          onConfirm={() =>
            call.mutate({
              path: widenPath(release),
              body: widenBody({ reason: reason.trim(), environments: named }),
            })
          }
        />
        <ConfirmButton
          label="Cover fleet"
          confirm={`Cover fleet for ${release}`}
          disabled={reason.trim() === "" || call.isPending}
          onConfirm={() =>
            call.mutate({
              path: widenPath(release),
              body: widenBody({ reason: reason.trim(), fleetWide: true }),
            })
          }
        />
      </div>
      {outcome && <Notice tone={outcome.tone}>{outcome.text}</Notice>}
    </div>
  );
};

export default RecallDetail;
