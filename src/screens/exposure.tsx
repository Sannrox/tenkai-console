import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { request } from "../api/http";
import type {
  AdvisoryFeedStatus,
  EffectiveCriticality,
  ExposureQueryResult,
  ManagementLifecycleResult,
} from "../api/tenkai.gen";
import { type DeliveryCapability, isRefused, useSession } from "../auth/session";
import {
  exposureCsv,
  exposureQueryPath,
  exposureRows,
  feedLine,
  uniqueReleases,
  type ExposureRow,
} from "../delivery/exposure";
import { recallBody } from "../management/catalog";
import {
  failure,
  newRequestId,
  refusesCredential,
  type Outcome,
} from "../management/use-management";
import { Button, Card, ConfirmButton, Notice } from "../ui/kit";
import { RefreshFailed, td, th } from "../ui/posture";

const field =
  "min-w-0 rounded-md border border-field bg-white/4 px-2.5 py-1.5 font-mono text-xs text-fg placeholder:text-muted";

const saveCsv = (fileName: string, text: string): void => {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
};

/**
 * Pick A (#41): advisory-feed status on the first line, query by component
 * and range, then environment/release/component/criticality/freshness.
 * Propose fix-forward recalls matching catalog releases over HTTP; Export CSV
 * is the result table.
 */
export const Exposure = () => {
  const token = useSession((state) => state.session?.accessToken);
  const feed = useQuery({
    queryKey: ["advisory-feed", token],
    queryFn: () => request<AdvisoryFeedStatus>("v1/advisory-feed", { token }),
    enabled: token !== undefined,
    retry: false,
  });
  const [component, setComponent] = useState("");
  const [range, setRange] = useState("");
  const [submitted, setSubmitted] = useState<{ component: string; range: string }>();
  const query = useQuery({
    queryKey: ["exposures", token, submitted?.component, submitted?.range],
    queryFn: () =>
      request<ExposureQueryResult>(
        exposureQueryPath(submitted?.component ?? "", submitted?.range ?? ""),
        { token },
      ),
    enabled: token !== undefined && submitted !== undefined,
    retry: false,
  });
  const products = [...new Set((query.data?.matches ?? []).map((match) => match.product))];
  const criticality = useQuery({
    queryKey: ["product-criticality", token, products],
    queryFn: async () => {
      const entries = await Promise.all(
        products.map(async (product) => {
          const view = await request<EffectiveCriticality>(
            `v1/products/${encodeURIComponent(product)}/criticality`,
            { token },
          );
          return [product, view] as const;
        }),
      );
      return Object.fromEntries(entries) as Record<string, EffectiveCriticality>;
    },
    enabled: token !== undefined && products.length > 0,
    retry: false,
  });
  if (token === undefined) {
    return null;
  }
  const rows = query.data ? exposureRows(query.data, criticality.data ?? {}) : [];
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="m-0 text-lg font-semibold">Exposure</h1>
        <span className="text-xs text-muted">
          {feed.error ? feed.error.message : feed.data ? feedLine(feed.data) : "Loading"}
        </span>
      </div>
      <RefreshFailed
        queries={[
          ["advisory-feed", feed],
          ["exposures", query],
        ]}
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          aria-label="Component"
          placeholder="Component"
          value={component}
          onChange={(event) => setComponent(event.target.value)}
          className={field}
        />
        <input
          aria-label="Range"
          placeholder="Range"
          value={range}
          onChange={(event) => setRange(event.target.value)}
          className={field}
        />
        <Button
          disabled={!component.trim() || !range.trim() || query.isFetching}
          onClick={() => setSubmitted({ component: component.trim(), range: range.trim() })}
        >
          Query
        </Button>
      </div>
      {query.error && !query.data && <Notice tone="bad">{query.error.message}</Notice>}
      {submitted && (
        <Results
          token={token}
          component={submitted.component}
          rows={rows}
          releases={query.data ? uniqueReleases(query.data) : []}
          loading={query.isPending}
        />
      )}
    </>
  );
};

const Results = ({
  token,
  component,
  rows,
  releases,
  loading,
}: {
  token: string;
  component: string;
  rows: ExposureRow[];
  releases: string[];
  loading: boolean;
}) => {
  const [exported, setExported] = useState<string>();
  const propose = useRecallReleases(token);
  return (
    <>
      <Card className="overflow-x-auto">
        {loading ? (
          <p className="m-0 px-3.5 py-2 text-xs text-muted">Loading</p>
        ) : (
          <table aria-label="Exposure" className="w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className={th}>Environment</th>
                <th className={th}>Release</th>
                <th className={th}>Component version</th>
                <th className={th}>Criticality</th>
                <th className={th}>Freshness</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className={`${td} text-muted`} colSpan={5}>
                    no matches
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={`${row.environment}|${row.release}|${row.componentVersion}`}>
                    <td className={td}>{row.environment}</td>
                    <td className={`${td} font-mono`}>{row.release}</td>
                    <td className={`${td} font-mono`}>{row.componentVersion}</td>
                    <td className={td}>{row.criticality}</td>
                    <td className={td}>{row.freshness}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </Card>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          disabled={rows.length === 0}
          onClick={() => {
            saveCsv(`exposure-${component}.csv`, exposureCsv(rows));
            setExported(`${rows.length} rows`);
          }}
        >
          Export CSV
        </Button>
        {propose.allowed && (
          <ConfirmButton
            label="Propose fix-forward"
            confirm={`Recall ${releases.join(", ")}`}
            disabled={releases.length === 0 || propose.isPending}
            onConfirm={() => propose.mutate(releases)}
          />
        )}
        {exported && <Notice tone="ok">{exported}</Notice>}
        {propose.outcome && <Notice tone={propose.outcome.tone}>{propose.outcome.text}</Notice>}
      </div>
    </>
  );
};

/**
 * Recalls each catalog release in the query result. The HTTP contract has
 * no propose route; this is the catalog half of `tenkaictl remediate propose`.
 */
const useRecallReleases = (token: string) => {
  const queryClient = useQueryClient();
  const capability: DeliveryCapability = "management";
  const allowed = useSession((state) => !isRefused(state.refused, "fleet", capability));
  const refuse = useSession((state) => state.refuse);
  const mutation = useMutation({
    mutationFn: async (releases: string[]) => {
      const messages: string[] = [];
      for (const release of releases) {
        const result = await request<ManagementLifecycleResult>(
          `v1/releases/${encodeURIComponent(release)}/recall`,
          { token, method: "POST", body: recallBody, requestId: newRequestId() },
        );
        messages.push(result.message);
      }
      return messages.join("; ");
    },
    onError: (error) => {
      if (refusesCredential(error)) {
        refuse(token, "fleet", capability);
      }
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["exposures"] }),
        queryClient.invalidateQueries({ queryKey: ["advisory-feed"] }),
        queryClient.invalidateQueries({ queryKey: ["events"] }),
        queryClient.invalidateQueries({ queryKey: ["channels"] }),
        queryClient.invalidateQueries({ queryKey: ["fleet"] }),
      ]),
  });
  const outcome: Outcome | undefined = mutation.isSuccess
    ? { tone: "ok", text: mutation.data }
    : mutation.error
      ? failure(mutation.error, capability)
      : undefined;
  return { ...mutation, allowed, outcome };
};
