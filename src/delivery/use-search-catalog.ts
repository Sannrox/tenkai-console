import { useQuery } from "@tanstack/react-query";
import { request } from "../api/http";
import type { AdvisoryFeedStatus, ReleasePage, RuntimeRunnerList } from "../api/tenkai.gen";
import { collectReleasePages } from "./releases";
import type { SearchCatalog } from "./search";
import { useDelivery } from "./use-delivery";

/** The list catalogs Search and quick search already share with those screens. */
export const useSearchCatalog = (token: string | undefined): SearchCatalog => {
  const delivery = useDelivery(token);
  const enabled = token !== undefined;
  const releases = useQuery({
    queryKey: ["releases", token],
    queryFn: () =>
      collectReleasePages((cursor) => {
        const query = cursor
          ? `v1/releases?limit=100&cursor=${encodeURIComponent(cursor)}`
          : "v1/releases?limit=100";
        return request<ReleasePage>(query, { token });
      }),
    enabled,
    retry: false,
  });
  const runners = useQuery({
    queryKey: ["runners", token],
    queryFn: () => request<RuntimeRunnerList>("v1/runners", { token }),
    enabled,
    retry: false,
  });
  const feed = useQuery({
    queryKey: ["advisory-feed", token],
    queryFn: () => request<AdvisoryFeedStatus>("v1/advisory-feed", { token }),
    enabled,
    retry: false,
  });
  const products = [
    ...new Set((delivery.channels?.items ?? []).map((item) => item.product)),
  ].toSorted();
  return {
    environments: delivery.fleet?.environments ?? delivery.list ?? [],
    products,
    releases: (releases.data?.items ?? []).map((item) => ({
      product: item.product,
      version: item.version,
    })),
    runners: runners.data?.runners ?? [],
    findings: (feed.data?.matches ?? []).map((item) => ({
      advisory_id: item.advisory_id,
      release: item.release,
      component: item.component,
    })),
  };
};
