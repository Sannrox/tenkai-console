import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useRouterState, useSearch } from "@tanstack/react-router";
import { request } from "../api/http";
import type { AdvisoryFeedStatus } from "../api/tenkai.gen";
import { useSession } from "../auth/session";
import { Card, Notice, ObjectPage, tabClass } from "../ui/kit";
import { td, th } from "../ui/posture";
import { Findings } from "./exposure-waivers";
import { EnvironmentLink, LinkedList, ProductLink, ReleaseLink } from "./object-link";
import { OBJECT_TABS, parseReleaseSpec, tabAfter } from "./objects";
import RecallDetail from "./recall-detail";

/**
 * Finding object page: affected releases and environments, fix path, waiver.
 * Waiver and recall keep the current requests.
 */
export const FindingPage = () => {
  const { advisory } = useParams({ strict: false }) as { advisory: string };
  const { release, component } = useSearch({ strict: false }) as {
    release?: string;
    component?: string;
  };
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const tab = tabAfter(pathname, "findings", 1);
  const token = useSession((state) => state.session?.accessToken);
  const feed = useQuery({
    queryKey: ["advisory-feed", token],
    queryFn: () => request<AdvisoryFeedStatus>("v1/advisory-feed", { token }),
    enabled: token !== undefined,
    retry: false,
  });
  const match = feed.data?.matches.find(
    (item) =>
      item.advisory_id === advisory &&
      (release === undefined || item.release === release) &&
      (component === undefined || item.component === component),
  );
  const spec = match?.release ?? release;
  const parsed = spec === undefined ? undefined : parseReleaseSpec(spec);
  const grace = match?.grace ?? [];
  const linkedItems = [
    ...(spec === undefined ? [] : [{ key: "release", node: <ReleaseLink spec={spec} /> }]),
    ...(parsed === undefined
      ? []
      : [{ key: "product", node: <ProductLink product={parsed.product} /> }]),
    ...grace.map((entry) => ({
      key: `env:${entry.environment}`,
      node: <EnvironmentLink environment={entry.environment} />,
    })),
  ];

  if (feed.error) {
    return (
      <ObjectPage kind="Finding" name={advisory}>
        <Notice tone="bad">
          {feed.error instanceof Error ? feed.error.message : String(feed.error)}
        </Notice>
      </ObjectPage>
    );
  }
  if (feed.isPending) {
    return (
      <ObjectPage kind="Finding" name={advisory}>
        <p className="m-0 text-xs text-muted">Loading</p>
      </ObjectPage>
    );
  }
  if (match === undefined) {
    return (
      <ObjectPage kind="Finding" name={advisory}>
        <p className="m-0 text-xs text-muted">No finding for this advisory.</p>
      </ObjectPage>
    );
  }

  return (
    <ObjectPage
      kind="Finding"
      name={advisory}
      status={match.severity}
      properties={[
        { label: "Release", value: spec ?? "none" },
        { label: "Component", value: `${match.component} ${match.component_version}` },
        { label: "Waiver", value: match.waiver ? match.waiver.reason : "none" },
      ]}
      tabs={
        <nav
          aria-label="Finding"
          className="mb-4 flex w-full min-w-0 gap-4 overflow-x-auto text-[13px] font-medium"
        >
          {OBJECT_TABS.map((item) => {
            const current = tab === item.id;
            const to =
              item.id === "overview" ? "/findings/$advisory" : "/findings/$advisory/linked";
            return (
              <Link
                key={item.id}
                to={to}
                params={{ advisory }}
                search={{
                  ...(release === undefined ? {} : { release }),
                  ...(component === undefined ? {} : { component }),
                }}
                aria-current={current ? "page" : undefined}
                className={`shrink-0 whitespace-nowrap ${tabClass(current)}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      }
      main={
        tab === "linked" ? (
          <LinkedList items={linkedItems} />
        ) : (
          <>
            <h2 className="mt-0 mb-2 text-[13px] font-semibold">Affected environments</h2>
            <Card className="mb-3 overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr>
                    <th className={th}>Environment</th>
                    <th className={th}>Grace</th>
                  </tr>
                </thead>
                <tbody>
                  {grace.length === 0 ? (
                    <tr>
                      <td className={`${td} text-muted`} colSpan={2}>
                        none
                      </td>
                    </tr>
                  ) : (
                    grace.map((entry) => (
                      <tr key={entry.environment}>
                        <td className={td}>
                          <EnvironmentLink environment={entry.environment} />
                        </td>
                        <td className={td}>
                          {entry.in_grace
                            ? `until ${new Date(entry.grace_ends_at).toISOString()}`
                            : "ended"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </Card>
            {token !== undefined && <Findings token={token} matches={[match]} />}
            {token !== undefined && spec !== undefined && (
              <>
                <h2 className="mt-0 mb-2 text-[13px] font-semibold">Fix path</h2>
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
