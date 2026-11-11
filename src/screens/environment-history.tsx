import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  type AttemptCause,
  type DeploymentAttempt,
  attemptAction,
  attemptDetail,
  attemptPlan,
  attemptTime,
  causeLine,
  causeRaw,
  causeSummary,
  causeTruncated,
  detailNeedsExpand,
  detailPreview,
  fetchHistory,
  nextCursor,
  restoreFailed,
  versionLine,
} from "../delivery/history";
import { Button, Card } from "../ui/kit";
import EnvironmentDrift from "./environment-drift";
import EnvironmentOverlays from "./environment-overlays";

const th = "border-b border-line px-3.5 py-2 text-left font-medium whitespace-nowrap text-muted";
const td = "border-b border-line px-3.5 py-2 align-top";

const COPY = {
  unavailable: "This server does not report deployment history.",
  forbidden: "No access",
  empty: "none",
  loading: "Loading",
  more: "More",
  all: "all",
} as const;

const STATUS_TONE: Record<string, string> = {
  succeeded: "text-ok",
  failed: "text-danger",
  rolled_back: "text-warning",
};

/**
 * Newest-first attempt list for the selected environment.
 * GET `/v1/environments/{environment}/history`.
 * Overlays and drift share this lazy chunk so the initial bundle stays on budget.
 */
export const EnvironmentHistory = ({
  environment,
  token,
  instances,
  instance,
  onInstance,
  report,
}: {
  environment: string;
  token: string;
  instances: string[];
  instance?: string;
  onInstance: (instance: string | undefined) => void;
  report?: unknown;
}) => {
  const query = useInfiniteQuery({
    queryKey: ["history", environment, instance, token],
    queryFn: async ({ pageParam }) => {
      const load = await fetchHistory(environment, token, {
        ...(instance === undefined ? {} : { instance }),
        ...(pageParam === undefined ? {} : { cursor: pageParam }),
      });
      if (load.kind === "error") {
        throw new Error(load.message);
      }
      return load;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.kind === "ok" ? nextCursor(last.value) : undefined),
    enabled: Boolean(environment),
    retry: false,
    // Successful pages and older-server probes stay still; a thrown load is
    // not stored as a page. Management and plan apply reset this query.
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });
  const first = query.data?.pages[0];
  const items =
    query.data?.pages.flatMap((page) => (page.kind === "ok" ? page.value.items : [])) ?? [];
  const options = instance && !instances.includes(instance) ? [instance, ...instances] : instances;
  const loadError = query.error instanceof Error ? query.error.message : "Could not load";

  let body;
  if (query.isPending && first === undefined) {
    body = <p className="m-0 px-3.5 py-3 text-xs text-muted">{COPY.loading}</p>;
  } else if (first?.kind === "unavailable") {
    body = <p className="m-0 px-3.5 py-3 text-xs text-muted">{COPY.unavailable}</p>;
  } else if (first?.kind === "forbidden") {
    body = <p className="m-0 px-3.5 py-3 text-xs text-muted">{COPY.forbidden}</p>;
  } else if (first === undefined) {
    body = (
      <p role="alert" className="m-0 px-3.5 py-3 text-xs text-danger">
        {loadError}
      </p>
    );
  } else if (items.length === 0) {
    body = <p className="m-0 px-3.5 py-3 text-xs text-muted">{COPY.empty}</p>;
  } else {
    body = (
      <>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className={th}>Time</th>
              <th className={th}>Instance</th>
              <th className={th}>From -&gt; to</th>
              <th className={th}>Action</th>
              <th className={th}>Status</th>
              <th className={th}>Plan</th>
              <th className={th}>Cause</th>
              <th className={th}>Restore</th>
            </tr>
          </thead>
          <tbody>
            {items.map((attempt) => (
              <AttemptRow key={attempt.id} environment={environment} attempt={attempt} />
            ))}
          </tbody>
        </table>
        {query.isFetchNextPageError && (
          <p role="alert" className="m-0 px-3.5 py-3 text-xs text-danger">
            {loadError}
          </p>
        )}
        {query.hasNextPage && (
          <div className="border-t border-line px-3.5 py-3">
            <Button disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
              {COPY.more}
            </Button>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      {report !== undefined && <EnvironmentOverlays report={report} />}
      {report !== undefined && <EnvironmentDrift report={report} />}
      <div className="mt-[18px] mb-2 flex flex-wrap items-baseline gap-2">
        <h2 className="m-0 text-[13px] font-semibold">History</h2>
        <label className="ml-auto flex items-center gap-2 text-xs font-medium text-muted">
          Instance
          <select
            aria-label="Instance"
            value={instance ?? ""}
            onChange={(event) =>
              onInstance(event.target.value === "" ? undefined : event.target.value)
            }
            className="rounded-md border border-field bg-white/4 px-2.5 py-1.5 text-xs text-fg"
          >
            <option value="">{COPY.all}</option>
            {options.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Card className="max-w-full min-w-0 overflow-x-auto">{body}</Card>
    </>
  );
};

const AttemptRow = ({
  environment,
  attempt,
}: {
  environment: string;
  attempt: DeploymentAttempt;
}) => {
  const plan = attemptPlan(attempt);
  const status = attempt.status;
  return (
    <tr className="[&:last-child>td]:border-b-0">
      <td className={`${td} font-mono whitespace-nowrap`}>{attemptTime(attempt.created_at)}</td>
      <td className={`${td} font-mono`}>{attempt.instance}</td>
      <td className={`${td} font-mono`}>{versionLine(attempt)}</td>
      <td className={`${td} ${attemptAction(attempt) === "none" ? "text-muted" : ""}`}>
        {attemptAction(attempt)}
      </td>
      <td className={`${td} ${STATUS_TONE[status] ?? ""}`}>{status}</td>
      <td className={`${td} font-mono ${plan === "none" ? "text-muted" : ""}`}>
        {plan === "none" ? (
          plan
        ) : (
          <Link
            to="/environments/$environment/plan"
            params={{ environment }}
            className="font-medium text-muted"
          >
            {plan}
          </Link>
        )}
      </td>
      <td className={td}>
        <CauseCell attempt={attempt} />
      </td>
      <td className={td}>
        <RestoreCell restore={attempt.restore} />
      </td>
    </tr>
  );
};

const CauseCell = ({ attempt }: { attempt: DeploymentAttempt }) => {
  if (attempt.cause === undefined) {
    return <DetailCell detail={attemptDetail(attempt)} />;
  }
  return <CauseExpand cause={attempt.cause} />;
};

const RestoreCell = ({ restore }: { restore: AttemptCause | undefined }) => {
  if (restore === undefined) {
    return <span className="text-muted">none</span>;
  }
  return (
    <div className={restoreFailed(restore) ? "text-danger" : undefined}>
      <CauseExpand cause={restore} />
    </div>
  );
};

const CauseExpand = ({ cause }: { cause: AttemptCause }) => {
  const preview = `${causeLine(cause)}: ${causeSummary(cause)}`;
  const raw = causeRaw(cause);
  const truncated = causeTruncated(cause) ? <span className="text-muted"> truncated</span> : null;
  if (raw === "") {
    return (
      <>
        {preview}
        {truncated}
      </>
    );
  }
  return (
    <details>
      <summary className="cursor-pointer">
        {preview}
        {truncated}
      </summary>
      <div className="mt-1 whitespace-pre-wrap">{raw}</div>
    </details>
  );
};

const DetailCell = ({ detail }: { detail: string }) => {
  if (detail === "") {
    return <span className="text-muted">none</span>;
  }
  if (!detailNeedsExpand(detail)) {
    return detail;
  }
  return (
    <details>
      <summary className="cursor-pointer">{detailPreview(detail)}</summary>
      <div className="mt-1 whitespace-pre-wrap">{detail}</div>
    </details>
  );
};

export default EnvironmentHistory;
