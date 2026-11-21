import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useRouterState, useSearch } from "@tanstack/react-router";
import { request } from "../api/http";
import type { EffectiveCriticality, ReleasePage } from "../api/tenkai.gen";
import { useSession } from "../auth/session";
import { channelHeadLabel, channelMatrix } from "../delivery/configuration";
import { fetchProductRouting, ownerLine } from "../delivery/owners";
import { collectReleasePages } from "../delivery/releases";
import { useDelivery, useEnvironmentInspect } from "../delivery/use-delivery";
import { Card, Notice, ObjectPage, tabClass } from "../ui/kit";
import { td, th } from "../ui/posture";
import { EnvironmentLink, LinkedList, PlanLink, ReleaseLink } from "./object-link";
import { OBJECT_TABS, releaseSpec, tabAfter } from "./objects";

/**
 * Product object page: channel heads, published releases, owner, criticality,
 * and environments from inspect of the environment on the link.
 */
export const ProductPage = () => {
  const { product } = useParams({ strict: false }) as { product: string };
  const { environment } = useSearch({ strict: false }) as { environment?: string };
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const tab = tabAfter(pathname, "products", 1);
  const token = useSession((state) => state.session?.accessToken);
  const delivery = useDelivery(token);
  const inspect = useEnvironmentInspect(token, environment);
  const owner = useQuery({
    queryKey: ["product-owner", product, token],
    queryFn: () => fetchProductRouting(product, token ?? ""),
    enabled: token !== undefined,
    retry: false,
  });
  const criticality = useQuery({
    queryKey: ["product-criticality", product, token],
    queryFn: () =>
      request<EffectiveCriticality>(`v1/products/${encodeURIComponent(product)}/criticality`, {
        token,
      }),
    enabled: token !== undefined,
    retry: false,
  });
  const releases = useQuery({
    queryKey: ["releases", token],
    queryFn: () =>
      collectReleasePages((cursor) => {
        const query = cursor
          ? `v1/releases?limit=100&cursor=${encodeURIComponent(cursor)}`
          : "v1/releases?limit=100";
        return request<ReleasePage>(query, { token });
      }),
    enabled: token !== undefined,
    retry: false,
  });

  const table = channelMatrix(delivery.channels);
  const channels = table.channels.flatMap((channel) => {
    const cell = table.cell(product, channel);
    return cell === undefined ? [] : [{ channel, version: cell.version }];
  });
  const published = (releases.data?.items ?? []).filter((item) => item.product === product);
  const runs = (inspect.data?.subscriptions ?? []).filter((item) => item.product === product);
  const ownerLoad = owner.data;
  const ownerText =
    ownerLoad?.kind === "ok"
      ? ownerLine(ownerLoad.value.owner)
      : ownerLoad?.kind === "forbidden"
        ? "No access"
        : ownerLoad?.kind === "unavailable"
          ? "unavailable"
          : owner.isPending
            ? "Loading"
            : "none";
  const crit = criticality.data?.effective ?? "none";
  const failed = delivery.channelsError ?? owner.error ?? criticality.error ?? releases.error;

  const linked = [
    ...runs.map((row) => ({
      key: `env:${inspect.data?.name ?? row.channel}`,
      node: inspect.data ? <EnvironmentLink environment={inspect.data.name} /> : row.channel,
    })),
    ...(inspect.data?.latest_plan
      ? [
          {
            key: "plan",
            node: (
              <PlanLink environment={inspect.data.name} planId={inspect.data.latest_plan.id}>
                plan
              </PlanLink>
            ),
          },
        ]
      : []),
    ...channels.map((row) => ({
      key: `rel:${row.version}`,
      node: (
        <ReleaseLink
          spec={releaseSpec(product, row.version)}
          {...(environment === undefined ? {} : { environment })}
        />
      ),
    })),
  ];
  // One environment may appear twice when several channels run there.
  const linkedItems = linked.filter(
    (item, index) => linked.findIndex((other) => other.key === item.key) === index,
  );

  return (
    <ObjectPage
      kind="Product"
      name={product}
      status={crit === "none" ? undefined : crit}
      properties={[
        { label: "Owner", value: ownerText },
        { label: "Criticality", value: crit },
        { label: "Channels", value: String(channels.length) },
      ]}
      tabs={
        <nav
          aria-label="Product"
          className="mb-4 flex w-full min-w-0 gap-4 overflow-x-auto text-[13px] font-medium"
        >
          {OBJECT_TABS.map((item) => {
            const current = tab === item.id;
            const to = item.id === "overview" ? "/products/$product" : "/products/$product/linked";
            return (
              <Link
                key={item.id}
                to={to}
                params={{ product }}
                search={environment === undefined ? {} : { environment }}
                aria-current={current ? "page" : undefined}
                className={`shrink-0 whitespace-nowrap ${tabClass(current)}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      }
      attention={
        failed ? (
          <Notice tone="bad">{failed instanceof Error ? failed.message : String(failed)}</Notice>
        ) : undefined
      }
      main={
        tab === "linked" ? (
          <LinkedList items={linkedItems} />
        ) : (
          <>
            <h2 className="mt-0 mb-2 text-[13px] font-semibold">Where it runs</h2>
            <Card className="mb-3 overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr>
                    <th className={th}>Environment</th>
                    <th className={th}>Channel</th>
                    <th className={th}>Deployed</th>
                    <th className={th}>Head</th>
                    <th className={th}>State</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.length === 0 ? (
                    <tr>
                      <td className={`${td} text-muted`} colSpan={5}>
                        {environment === undefined
                          ? "Open from an environment to see where it runs."
                          : inspect.isPending
                            ? "Loading"
                            : "none"}
                      </td>
                    </tr>
                  ) : (
                    runs.map((row) => (
                      <tr key={`${inspect.data?.name}:${row.channel}`}>
                        <td className={td}>
                          {inspect.data ? (
                            <EnvironmentLink environment={inspect.data.name} />
                          ) : (
                            environment
                          )}
                        </td>
                        <td className={td}>{row.channel}</td>
                        <td className={`${td} font-mono`}>{row.deployed ?? "none"}</td>
                        <td className={`${td} font-mono`}>
                          <ReleaseLink
                            spec={releaseSpec(product, channelHeadLabel(row.head))}
                            {...(environment === undefined ? {} : { environment })}
                          >
                            {channelHeadLabel(row.head)}
                          </ReleaseLink>
                        </td>
                        <td className={td}>{row.state}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </Card>
            <h2 className="mt-0 mb-2 text-[13px] font-semibold">Channel heads</h2>
            <Card className="mb-3 overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr>
                    <th className={th}>Channel</th>
                    <th className={th}>Head</th>
                  </tr>
                </thead>
                <tbody>
                  {channels.length === 0 ? (
                    <tr>
                      <td className={`${td} text-muted`} colSpan={2}>
                        {delivery.channelsLoading ? "Loading" : "none"}
                      </td>
                    </tr>
                  ) : (
                    channels.map((row) => (
                      <tr key={row.channel}>
                        <td className={td}>{row.channel}</td>
                        <td className={`${td} font-mono`}>
                          <ReleaseLink
                            spec={releaseSpec(product, row.version)}
                            {...(environment === undefined ? {} : { environment })}
                          >
                            {row.version}
                          </ReleaseLink>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </Card>
            <h2 className="mt-0 mb-2 text-[13px] font-semibold">Releases</h2>
            <Card className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr>
                    <th className={th}>Version</th>
                    <th className={th}>Id</th>
                  </tr>
                </thead>
                <tbody>
                  {published.length === 0 ? (
                    <tr>
                      <td className={`${td} text-muted`} colSpan={2}>
                        {releases.isPending ? "Loading" : "none"}
                      </td>
                    </tr>
                  ) : (
                    published.map((item) => (
                      <tr key={item.id}>
                        <td className={`${td} font-mono`}>
                          <ReleaseLink
                            spec={releaseSpec(item.product, item.version)}
                            {...(environment === undefined ? {} : { environment })}
                          >
                            {item.version}
                          </ReleaseLink>
                        </td>
                        <td className={`${td} font-mono text-muted`}>{item.id}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </Card>
          </>
        )
      }
      linked={tab === "overview" ? <LinkedList items={linkedItems} /> : undefined}
    />
  );
};
