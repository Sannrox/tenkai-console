import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, request } from "../api/http";
import type { EnvironmentPlanSummary } from "../api/tenkai.gen";
import {
  DIFF_COPY,
  type FieldDiff,
  type ObjectDiff,
  type StepDiff,
  capRows,
  countsOnly,
  cutValue,
  fieldsLabel,
  planPath,
  stepDiffs,
} from "../plan/target-changes";
import { Button, Card } from "../ui/kit";

const COPY = {
  none: "No target changes",
  older: "This server does not report target changes",
  forbidden: "No access to target changes",
  failed: "Could not load target changes",
  loading: "Loading",
  full: "Show full diff",
  hidden: (count: number) => `${count} more field changes not shown`,
} as const;

/** 404 or 405 on an existing plan means the server predates the plan route. */
const failure = (error: Error): string =>
  error instanceof ApiError && (error.status === 404 || error.status === 405)
    ? COPY.older
    : error instanceof ApiError && error.status === 403
      ? COPY.forbidden
      : COPY.failed;

/**
 * What the plan changes in the target, above the approval controls so an
 * approver reads it before signing. Inspect gives per-object counts; the full
 * diff loads from the plan route on request. With no counts in inspect, the
 * plan route tells "no changes" apart from an older server.
 */
export const TargetChanges = ({ plan, token }: { plan: EnvironmentPlanSummary; token: string }) => {
  const [requested, setRequested] = useState(false);
  const summary = stepDiffs(plan);
  const probe = summary.length === 0;
  const full = useQuery({
    queryKey: ["plan-full", plan.id, token],
    queryFn: () => request<EnvironmentPlanSummary>(planPath(plan.id), { token }),
    enabled: requested || probe,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const diffs = full.data ? stepDiffs(full.data) : summary;
  const objects = diffs.reduce((total, step) => total + step.objects.length, 0);

  let status: string | undefined;
  if (full.error) {
    status = failure(full.error);
  } else if (full.isFetching && (requested || objects === 0)) {
    status = COPY.loading;
  } else if (objects === 0) {
    status = COPY.none;
  }

  return (
    <section aria-label="Target changes">
      <h2 className="mt-[18px] mb-2 flex items-center gap-2 text-[13px] font-semibold">
        Target changes
        {objects > 0 && (
          <span className="font-mono text-[11px] font-medium text-muted">{objects}</span>
        )}
        {objects > 0 && !full.data && countsOnly(diffs) && (
          <Button
            className="ml-auto"
            disabled={full.isFetching}
            onClick={() => {
              setRequested(true);
              if (full.error) {
                void full.refetch();
              }
            }}
          >
            {COPY.full}
          </Button>
        )}
      </h2>
      {status && (
        <p
          className={`m-0 mb-2 text-xs ${full.error && status !== COPY.older ? "text-danger" : "text-muted"}`}
        >
          {status}
        </p>
      )}
      {objects > 0 && <Diff diffs={diffs} />}
    </section>
  );
};

const Diff = ({ diffs }: { diffs: StepDiff[] }) => {
  const { shown, hidden } = capRows(diffs);
  return (
    <Card className="min-w-0 px-3.5 py-3 font-mono text-xs leading-[1.7]">
      {diffs.map((step) => (
        <div key={step.id} className="border-t border-line pt-2 first:border-t-0 first:pt-0">
          <div className="font-semibold">{step.label}</div>
          {step.objects.map((object) => (
            <ObjectRows key={`${object.kind}/${object.name}`} object={object} shown={shown} />
          ))}
        </div>
      ))}
      {hidden > 0 && <div className="text-muted">{COPY.hidden(hidden)}</div>}
    </Card>
  );
};

const ObjectRows = ({ object, shown }: { object: ObjectDiff; shown: Set<FieldDiff> }) => (
  <div className="pl-3">
    <div className="flex flex-wrap gap-x-3">
      <span className="break-all">
        {object.kind} {object.name}
      </span>
      <span className={object.secret ? "text-warning" : "text-muted"}>
        {object.secret
          ? DIFF_COPY.secret
          : object.created
            ? `${DIFF_COPY.created}${object.count > 0 ? `, ${fieldsLabel(object.count)}` : ""}`
            : fieldsLabel(object.count)}
      </span>
    </div>
    {object.fields
      ?.filter((field) => shown.has(field))
      .map((field, index) => (
        <div
          // Field names may repeat inside one object; order is the server's.
          // oxlint-disable-next-line react/no-array-index-key
          key={`${field.field}:${index}`}
          className="grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)] gap-x-3 pl-3"
        >
          <span className="break-all text-muted">{field.field}</span>
          <span className="min-w-0 break-all whitespace-pre-wrap">
            {field.from === undefined ? null : (
              <span className="block text-danger">- {cutValue(field.from)}</span>
            )}
            {field.to === undefined ? null : (
              <span className="block text-ok">+ {cutValue(field.to)}</span>
            )}
            {field.from === undefined && field.to === undefined && (
              <span className="text-muted">{DIFF_COPY.changed}</span>
            )}
          </span>
        </div>
      ))}
  </div>
);
