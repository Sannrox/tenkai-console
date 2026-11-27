import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useRouterState, useSearch } from "@tanstack/react-router";
import { lazy, Suspense, useState } from "react";
import { request } from "../api/http";
import type { ChangeEventPage, EffectiveCriticality } from "../api/tenkai.gen";
import { useSession } from "../auth/session";
import { channelMatrix, fleetTableRows } from "../delivery/configuration";
import { recallEvents } from "../delivery/exposure";
import { fetchProductRouting, ownerLine } from "../delivery/owners";
import { useDelivery, useEnvironmentInspect } from "../delivery/use-delivery";
import { useManagementCall } from "../management/use-management";
import { ActionsMenu, Card, ObjectPage, tabClass } from "../ui/kit";
import { td, th } from "../ui/posture";
import { ActionPanel } from "./environment-object";
import { EnvironmentLink, LinkedList, PlanLink, ReleaseLink } from "./object-link";
import { PRODUCT_TABS, releaseSpec, tabAfter } from "./objects";
import { PromotionPolicies } from "./promotion-policies";
import { Catalog, type CatalogMode, RecallFollow } from "./releases";

const ChannelPace = lazy(() => import("./channel-pace"));
const ProductOwners = lazy(() => import("./product-owners"));

const message = (result: { message: string }) => result.message;

/**
 * Product object page: channel heads as a version table, this product's
 * catalog writes in Actions, recalls on their own tab.
 */
export const ProductPage = () => {
  const { product } = useParams({ strict: false }) as { product: string };
  const { environment } = useSearch({ strict: false }) as { environment?: string };
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const tab = tabAfter(pathname, "products", 1, PRODUCT_TABS);
  const token = useSession((state) => state.session?.accessToken);
  const delivery = useDelivery(token);
  const inspect = useEnvironmentInspect(token, environment);
  const [catalog, setCatalog] = useState<CatalogMode | undefined>();
  const publish = useManagementCall(token ?? "", "fleet", "publish", message);
  const recall = useManagementCall(token ?? "", "fleet", "management", message);
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
  const events = useQuery({
    queryKey: ["events", token],
    queryFn: () => request<ChangeEventPage>("v1/events?limit=100", { token }),
    enabled: token !== undefined,
    retry: false,
  });

  const table = channelMatrix(delivery.channels);
  const channels = table.channels.flatMap((channel) => {
    const cell = table.cell(product, channel);
    return cell === undefined ? [] : [{ channel, version: cell.version }];
  });
  const runs = (inspect.data?.subscriptions ?? []).filter((item) => item.product === product);
  const recalled = new Set(
    events.data
      ? recallEvents(events.data.events)
          .map((event) => event.resource)
          .filter((release) => release.startsWith(`${product}@`))
      : [],
  );
  const versions = channels.map((row) => {
    const spec = releaseSpec(product, row.version);
    return {
      ...row,
      spec,
      status: recalled.has(spec) ? "recall" : "head",
    };
  });
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
  const envSearch = environment === undefined ? {} : { environment };
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
      node: <ReleaseLink spec={releaseSpec(product, row.version)} {...envSearch} />,
    })),
  ];
  const linkedItems = linked.filter(
    (item, index) => linked.findIndex((other) => other.key === item.key) === index,
  );
  const publishAllowed = token !== undefined && publish.allowed;
  const recallAllowed = token !== undefined && recall.allowed;
  const actionItems = [
    ...(publishAllowed ? [{ label: "Publish", onClick: () => setCatalog("publish") }] : []),
    ...(publishAllowed ? [{ label: "Promote", onClick: () => setCatalog("promote") }] : []),
    ...(recallAllowed ? [{ label: "Recall releases", onClick: () => setCatalog("recall") }] : []),
  ];
  const needed = recalled.size > 0;
  const unknown = publish.outcome?.tone === "unknown" || recall.outcome?.tone === "unknown";

  return (
    <ObjectPage
      kind="Product"
      name={product}
      status={
        owner.isPending && delivery.channelsLoading
          ? "Loading"
          : unknown
            ? "outcome unknown"
            : undefined
      }
      actions={
        actionItems.length > 0 ? (
          <ActionsMenu needed={needed || unknown} items={actionItems} />
        ) : undefined
      }
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
          {PRODUCT_TABS.map((item) => {
            const current = tab === item.id;
            const to =
              item.id === "overview"
                ? "/products/$product"
                : item.id === "recalls"
                  ? "/products/$product/recalls"
                  : "/products/$product/linked";
            return (
              <Link
                key={item.id}
                to={to}
                params={{ product }}
                search={(prev: { environment?: string }) =>
                  environment === undefined ? prev : { ...prev, environment }
                }
                aria-current={current ? "page" : undefined}
                className={`shrink-0 whitespace-nowrap ${tabClass(current)}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      }
    >
      {tab === "linked" ? (
        <LinkedList items={linkedItems} />
      ) : tab === "recalls" ? (
        token === undefined ? (
          <p className="m-0 text-xs text-muted">Loading</p>
        ) : (
          <RecallFollow
            token={token}
            fleet={fleetTableRows(delivery.fleet, delivery.list)}
            product={product}
          />
        )
      ) : (
        <>
          {catalog !== undefined && token !== undefined && (
            <ActionPanel>
              <Catalog token={token} channels={table.channels} product={product} mode={catalog} />
            </ActionPanel>
          )}
          <p className="mb-3 flex flex-wrap justify-between gap-2 text-xs">
            <span>
              {channels.length === 0
                ? delivery.channelsLoading
                  ? "Loading"
                  : "none"
                : channels.map((row) => `${row.channel} ${row.version}`).join(" · ")}
            </span>
            {recalled.size > 0 ? (
              <span className="text-warning">
                {recalled.size} {recalled.size === 1 ? "recall" : "recalls"} in removal
              </span>
            ) : null}
          </p>
          <Card className="mb-3 overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr>
                  <th className={th}>Version</th>
                  <th className={th}>Channel</th>
                  <th className={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {versions.length === 0 ? (
                  <tr>
                    <td className={`${td} text-muted`} colSpan={3}>
                      {delivery.channelsLoading ? "Loading" : "none"}
                    </td>
                  </tr>
                ) : (
                  versions.map((row) => (
                    <tr key={row.channel}>
                      <td className={`${td} font-mono`}>
                        <ReleaseLink spec={row.spec} {...envSearch}>
                          {row.version}
                        </ReleaseLink>
                      </td>
                      <td className={td}>{row.channel}</td>
                      <td className={`${td} ${row.status === "recall" ? "text-warning" : ""}`}>
                        {row.status}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </Card>
          {token !== undefined && (
            <Suspense fallback={null}>
              <ChannelPace token={token} items={delivery.channels?.items ?? []} product={product} />
            </Suspense>
          )}
          <PromotionPolicies
            fleet={delivery.fleet}
            loading={delivery.loading}
            token={token}
            product={product}
          />
          {token !== undefined && (
            <Suspense fallback={null}>
              <ProductOwners token={token} products={[product]} fleet={delivery.fleet} />
            </Suspense>
          )}
        </>
      )}
    </ObjectPage>
  );
};
