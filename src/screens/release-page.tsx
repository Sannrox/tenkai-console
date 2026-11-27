import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useRouterState, useSearch } from "@tanstack/react-router";
import { useSession } from "../auth/session";
import { channelHeadLabel, channelMatrix, fleetTableRows } from "../delivery/configuration";
import { environmentRows, fetchRecall, recallBanner } from "../delivery/recall";
import { useDelivery, useEnvironmentInspect } from "../delivery/use-delivery";
import { Card, ObjectPage, tabClass } from "../ui/kit";
import { td, th } from "../ui/posture";
import { Compatibility } from "./compatibility";
import { EnvironmentLink, ProductLink } from "./object-link";
import { RELEASE_TABS, releaseSpec, tabAfter } from "./objects";
import { useReleaseWiden } from "./recall-detail";
import ReleaseLabels from "./release-labels";

/**
 * Release object page: channels beside environments, installations, and
 * recall copy under the tabs. Widen stays in Actions.
 */
export const ReleasePage = () => {
  const { product, version } = useParams({ strict: false }) as { product: string; version: string };
  const { environment } = useSearch({ strict: false }) as { environment?: string };
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const tab = tabAfter(pathname, "releases", 2, RELEASE_TABS);
  const token = useSession((state) => state.session?.accessToken);
  const delivery = useDelivery(token);
  const spec = releaseSpec(product, version);
  const table = channelMatrix(delivery.channels);
  const channels = table.channels.filter(
    (channel) => table.cell(product, channel)?.version === version,
  );
  const names = fleetTableRows(delivery.fleet, delivery.list).map((row) => row.name);
  const inspect = useEnvironmentInspect(token, environment);
  const report = inspect.data;
  const widen = useReleaseWiden(token, spec);
  const recall = useQuery({
    queryKey: ["recall", token, spec],
    queryFn: () => fetchRecall(spec, token ?? ""),
    enabled: token !== undefined,
    retry: false,
  });
  const view = recall.data?.kind === "ok" ? recall.data.value : undefined;
  const banner = view === undefined ? undefined : recallBanner(view);
  const envSearch = environment === undefined ? {} : { environment };
  const fromInspect =
    report === undefined
      ? []
      : report.subscriptions
          .filter(
            (row) =>
              row.product === product &&
              (row.deployed === version || channelHeadLabel(row.head) === version),
          )
          .map((row) => ({
            environment: report.name,
            state: row.state,
          }));
  const fromRecall =
    view === undefined
      ? []
      : environmentRows(view).map((row) => ({
          environment: row.environment,
          state: row.scope === "keep" ? "keep" : "in removal",
        }));
  const installations = (fromRecall.length > 0 ? fromRecall : fromInspect).filter(
    (row, index, list) =>
      list.findIndex((other) => other.environment === row.environment) === index,
  );

  return (
    <ObjectPage
      kind="Release"
      name={spec}
      status={
        delivery.channelsLoading && recall.data === undefined
          ? "Loading"
          : widen.unknown
            ? "outcome unknown"
            : undefined
      }
      actions={widen.menu}
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
          {RELEASE_TABS.map((item) => {
            const current = tab === item.id;
            const to =
              item.id === "overview"
                ? "/releases/$product/$version"
                : "/releases/$product/$version/installations";
            return (
              <Link
                key={item.id}
                to={to}
                params={{ product, version }}
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
      <>
        {banner !== undefined && tab === "overview" && (
          <p className="mb-3 border border-danger/35 px-2.5 py-2 text-xs text-danger">{banner}</p>
        )}
        {tab === "installations" ? (
          <InstallationsTable
            rows={installations}
            loading={inspect.isPending && environment !== undefined}
            empty={
              environment === undefined && fromRecall.length === 0
                ? "Open from an environment to see where it runs."
                : "none"
            }
          />
        ) : (
          <>
            <div className="grid min-w-0 gap-4 lg:grid-cols-2">
              <section className="min-w-0">
                <h2 className="mt-0 mb-2 text-[13px] font-semibold">Channels</h2>
                <Card className="overflow-x-auto">
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
              </section>
              <section className="min-w-0">
                <h2 className="mt-0 mb-2 text-[13px] font-semibold">Environments</h2>
                <InstallationsTable
                  rows={installations}
                  loading={inspect.isPending && environment !== undefined}
                  empty={
                    environment === undefined && fromRecall.length === 0
                      ? "Open from an environment to see where it runs."
                      : "none"
                  }
                />
              </section>
            </div>
            {token !== undefined && (
              <Compatibility token={token} environments={names} release={spec} />
            )}
            {token !== undefined && <ReleaseLabels token={token} release={spec} />}
          </>
        )}
      </>
    </ObjectPage>
  );
};

const InstallationsTable = ({
  rows,
  loading,
  empty,
}: {
  rows: ReadonlyArray<{ environment: string; state: string }>;
  loading: boolean;
  empty: string;
}) => (
  <Card className="overflow-x-auto">
    <table className="w-full border-collapse text-xs">
      <thead>
        <tr>
          <th className={th}>Environment</th>
          <th className={th}>Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td className={`${td} text-muted`} colSpan={2}>
              {loading ? "Loading" : empty}
            </td>
          </tr>
        ) : (
          rows.map((row) => (
            <tr key={row.environment}>
              <td className={td}>
                <EnvironmentLink environment={row.environment} />
              </td>
              <td
                className={`${td} ${row.state === "in removal" || row.state === "behind" ? "text-warning" : row.state === "current" || row.state === "soaking" ? "text-ok" : ""}`}
              >
                {row.state}
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  </Card>
);
