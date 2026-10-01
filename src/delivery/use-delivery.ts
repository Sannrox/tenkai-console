import { useQueries, useQuery } from "@tanstack/react-query";
import { request } from "../api/http";
import type { EnvironmentInspectReport, EnvironmentListEntry } from "../api/tenkai.gen";

/** Environment list plus one inspect per environment, fetched in parallel. */
export const useDelivery = (token: string) => {
  const list = useQuery({
    queryKey: ["environments", token],
    queryFn: () => request<EnvironmentListEntry[]>("v1/environments", { token }),
    retry: false,
  });
  const inspects = useQueries({
    queries: (list.data ?? []).map((entry) => ({
      queryKey: ["environment", entry.name, token],
      queryFn: () =>
        request<EnvironmentInspectReport>(`v1/environments/${encodeURIComponent(entry.name)}`, {
          token,
        }),
      retry: false,
    })),
  });
  const reports = inspects.flatMap((query) => (query.data ? [query.data] : []));
  const failed = inspects.find((query) => query.error)?.error ?? null;
  return {
    list,
    reports,
    loading: list.isPending || inspects.some((query) => query.isPending),
    error: list.error ?? failed,
  };
};
