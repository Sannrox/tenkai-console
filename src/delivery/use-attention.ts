import { useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "../api/http";
import type { ChangeEventPage, RuntimeRunnerList } from "../api/tenkai.gen";
import { fleetAttention } from "./configuration";
import { useDelivery } from "./use-delivery";

export type AttentionSourceId = "fleet" | "runners" | "events";

/**
 * Fleet, runners, and events as independent bulk reads. A failed source
 * leaves the others in place so the list can say it is incomplete.
 */
export const useAttention = (token: string | undefined) => {
  const client = useQueryClient();
  const delivery = useDelivery(token);
  const enabled = token !== undefined;
  const runners = useQuery({
    queryKey: ["runners", token],
    queryFn: () => request<RuntimeRunnerList>("v1/runners", { token }),
    enabled,
    retry: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
  const events = useQuery({
    queryKey: ["events", token],
    queryFn: () => request<ChangeEventPage>("v1/events?limit=100", { token }),
    enabled,
    retry: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
  const failed: AttentionSourceId[] = [
    ...(delivery.error ? (["fleet"] as const) : []),
    ...(runners.error ? (["runners"] as const) : []),
    ...(events.error ? (["events"] as const) : []),
  ];
  const retry = () => {
    if (delivery.error) {
      void client.invalidateQueries({ queryKey: ["fleet", token] });
      void client.invalidateQueries({ queryKey: ["environments", token] });
    }
    if (runners.error) {
      void client.invalidateQueries({ queryKey: ["runners", token] });
    }
    if (events.error) {
      void client.invalidateQueries({ queryKey: ["events", token] });
    }
  };
  return {
    items: fleetAttention({
      environments: delivery.fleet?.environments ?? [],
      runners: runners.data?.runners ?? [],
      events: events.data?.events ?? [],
    }),
    fleet: delivery.fleet,
    list: delivery.list,
    loading: delivery.loading,
    error: delivery.error,
    failed,
    retry,
  };
};
