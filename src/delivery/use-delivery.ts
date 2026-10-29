import { useQuery } from "@tanstack/react-query";
import { ApiError, request } from "../api/http";
import type {
  ChannelPage,
  EnvironmentInspectReport,
  EnvironmentListEntry,
  FleetStatusReport,
} from "../api/tenkai.gen";
import { collectChannelPages } from "./channels";

const read = async <T>(path: string, token: string | undefined): Promise<T> => {
  try {
    return await request<T>(path, { token });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 0;
    const detail = error instanceof Error ? error.message : String(error);
    throw new ApiError(status, `${path}: ${detail}`);
  }
};

/**
 * Fleet tables from bulk routes: `v1/fleet/status`, the environment list, and
 * paginated `v1/channels`. Inspect is a separate hook for the selected row.
 */
export const useDelivery = (token: string | undefined) => {
  const enabled = token !== undefined;
  const fleet = useQuery({
    queryKey: ["fleet", token],
    queryFn: () => read<FleetStatusReport>("v1/fleet/status", token),
    enabled,
    retry: false,
  });
  const list = useQuery({
    queryKey: ["environments", token],
    queryFn: () => read<EnvironmentListEntry[]>("v1/environments", token),
    enabled,
    retry: false,
  });
  const channels = useQuery({
    queryKey: ["channels", token],
    queryFn: () =>
      collectChannelPages((cursor) => {
        const query = cursor
          ? `v1/channels?limit=100&cursor=${encodeURIComponent(cursor)}`
          : "v1/channels?limit=100";
        return read<ChannelPage>(query, token);
      }),
    enabled,
    retry: false,
  });
  return {
    fleet: fleet.data,
    list: list.data,
    channels: channels.data,
    loading: fleet.isPending || list.isPending,
    channelsLoading: channels.isPending,
    error: fleet.error ?? list.error,
    channelsError: channels.error,
  };
};

/** Inspect one environment; used by the environments detail rail. */
export const useEnvironmentInspect = (token: string | undefined, name: string | undefined) =>
  useQuery({
    queryKey: ["environment", name, token],
    queryFn: () =>
      read<EnvironmentInspectReport>(`v1/environments/${encodeURIComponent(name ?? "")}`, token),
    enabled: token !== undefined && Boolean(name),
    retry: false,
  });
