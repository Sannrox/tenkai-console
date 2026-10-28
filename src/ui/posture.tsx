import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { request } from "../api/http";
import type { TrustPosture } from "../api/tenkai.gen";
import { Notice } from "./kit";

/** Shared by the Server and Trust tabs: table cells, status colours, the trust query. */

export const th =
  "border-b border-line px-3.5 py-2 text-left font-medium whitespace-nowrap text-muted";
export const td = "border-b border-line px-3.5 py-2 align-top whitespace-nowrap";

/** A certificate status in ok, warning or bad colour. */
export const STATUS_TONE: Record<string, string> = {
  ok: "",
  warning: "text-warning",
  critical: "text-danger",
  expired: "text-danger",
};

/** GET `/v1/trust`, one cache entry per credential for both tabs. */
export const useTrustPosture = (token: string | undefined) =>
  useQuery({
    queryKey: ["trust", token],
    queryFn: () => request<TrustPosture>("v1/trust", { token }),
    enabled: token !== undefined,
    retry: false,
  });

/**
 * One line per query whose refresh failed while earlier data is still
 * shown, naming when that data is from.
 */
export const RefreshFailed = ({
  queries,
}: {
  queries: ReadonlyArray<readonly [string, UseQueryResult]>;
}) =>
  queries.map(([name, query]) =>
    query.error && query.data !== undefined ? (
      <div key={name} className="mb-3">
        <Notice tone="bad">
          Refresh failed: {query.error.message}. Showing data from{" "}
          {new Date(query.dataUpdatedAt).toISOString()}.
        </Notice>
      </div>
    ) : null,
  );
