import { Link, useParams, useRouterState, useSearch } from "@tanstack/react-router";
import { useSession } from "../auth/session";
import { channelMatrix, fleetTableRows } from "../delivery/configuration";
import { promotionPolicies } from "../delivery/promotion-policies";
import { useDelivery } from "../delivery/use-delivery";
import { Card, Notice, ObjectPage, tabClass } from "../ui/kit";
import { td, th } from "../ui/posture";
import { Compatibility } from "./compatibility";
import { EnvironmentLink, LinkedList, PlanLink, ProductLink } from "./object-link";
import { OBJECT_TABS, releaseSpec, tabAfter } from "./objects";
import RecallDetail from "./recall-detail";
import ReleaseLabels from "./release-labels";

/**
 * Release object page: channels that point here, promotion policy, compatibility,
 * labels, recall. Actions keep the same requests as the catalog screen.
 */
export const ReleasePage = () => {
  const { product, version } = useParams({ strict: false }) as { product: string; version: string };
  const { environment } = useSearch({ strict: false }) as { environment?: string };
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const tab = tabAfter(pathname, "releases", 2);
  const token = useSession((state) => state.session?.accessToken);
  const delivery = useDelivery(token);
  const spec = releaseSpec(product, version);
  const table = channelMatrix(delivery.channels);
  const channels = table.channels.filter(
    (channel) => table.cell(product, channel)?.version === version,
  );
  const names = fleetTableRows(delivery.fleet, delivery.list).map((row) => row.name);
  const policyLoad =
    delivery.fleet === undefined ? undefined : promotionPolicies(delivery.fleet, true);
  const policyRows =
    policyLoad?.kind === "ok" ? policyLoad.rows.filter((row) => row.product === product) : [];
  const failed = delivery.channelsError ?? delivery.error;
  const envSearch = environment === undefined ? {} : { environment };

  const linkedItems = [
    { key: "product", node: <ProductLink product={product} {...envSearch} /> },
    ...channels.map((channel) => ({ key: `ch:${channel}`, node: <span>{channel}</span> })),
    ...(environment === undefined
      ? []
      : [
          { key: "env", node: <EnvironmentLink environment={environment} /> },
          {
            key: "plan",
            node: <PlanLink environment={environment}>plan</PlanLink>,
          },
        ]),
  ];

  return (
    <ObjectPage
      kind="Release"
      name={spec}
      properties={[
        { label: "Product", value: <ProductLink product={product} {...envSearch} /> },
        { label: "Version", value: version },
        { label: "Channels", value: channels.length === 0 ? "none" : channels.join(", ") },
      ]}
      tabs={
        <nav
          aria-label="Release"
          className="mb-4 flex w-full min-w-0 gap-4 overflow-x-auto text-[13px] font-medium"
        >
          {OBJECT_TABS.map((item) => {
            const current = tab === item.id;
            const to =
              item.id === "overview"
                ? "/releases/$product/$version"
                : "/releases/$product/$version/linked";
            return (
              <Link
                key={item.id}
                to={to}
                params={{ product, version }}
                search={envSearch}
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
            <h2 className="mt-0 mb-2 text-[13px] font-semibold">Channels</h2>
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
                        {delivery.channelsLoading ? "Loading" : "not a channel head"}
                      </td>
                    </tr>
                  ) : (
                    channels.map((channel) => (
                      <tr key={channel}>
                        <td className={td}>{channel}</td>
                        <td className={`${td} font-mono`}>{version}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </Card>
            {policyRows.length > 0 && (
              <>
                <h2 className="mt-0 mb-2 text-[13px] font-semibold">Promotion policy</h2>
                <Card className="mb-3 overflow-x-auto">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr>
                        <th className={th}>From -&gt; to</th>
                        <th className={th}>State</th>
                        <th className={th}>Paused</th>
                      </tr>
                    </thead>
                    <tbody>
                      {policyRows.map((row) => (
                        <tr key={`${row.source_channel}:${row.target_channel}`}>
                          <td className={td}>
                            {row.source_channel} -&gt; {row.target_channel}
                          </td>
                          <td className={td}>{row.state}</td>
                          <td className={td}>{row.paused ? "paused" : "no"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              </>
            )}
            {token !== undefined && (
              <Compatibility token={token} environments={names} release={spec} />
            )}
            {token !== undefined && (
              <>
                <ReleaseLabels token={token} release={spec} />
                <RecallDetail token={token} release={spec} />
              </>
            )}
          </>
        )
      }
      linked={tab === "overview" ? <LinkedList items={linkedItems} /> : undefined}
    />
  );
};
