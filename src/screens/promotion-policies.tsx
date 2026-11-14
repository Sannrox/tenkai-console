import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useState, type ReactNode } from "react";
import { request } from "../api/http";
import type { FleetStatusReport } from "../api/tenkai.gen";
import {
  evaluatesPolicies,
  promotionPolicies,
  type PolicyStatus,
} from "../delivery/promotion-policies";
import { Button, Card } from "../ui/kit";
import { td, th } from "../ui/posture";

// Rules, soak progress, and pause/resume load on the first Detail click.
const PolicyDetail = lazy(() => import("./promotion-policy-detail"));

const STATE_TONE: Record<string, string> = {
  promoted: "text-ok",
  reset: "text-danger",
  refused: "text-danger",
  recalled: "text-danger",
};

const EMPTY = {
  none: "No promotion policies.",
  unavailable: "This server does not report promotion policies.",
  unreadable: "Promotion policies could not be read.",
};

/**
 * Promotion policy rows from `v1/fleet/status` on the Releases screen: one
 * row per target channel, with the instances lacking evidence. Signed in,
 * Detail opens one policy's rules, soak progress, and pause or resume.
 */
export const PromotionPolicies = ({
  fleet,
  loading,
  token,
}: {
  fleet: FleetStatusReport | undefined;
  loading: boolean;
  token: string | undefined;
}) => {
  const [selected, setSelected] = useState<{ product: string; channel: string }>();
  // `/healthz` is public and cached for the session; only its capabilities matter here.
  const health = useQuery({
    queryKey: ["healthz"],
    queryFn: () => request<unknown>("healthz", {}),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  const load = promotionPolicies(fleet, evaluatesPolicies(health.data));
  return (
    <section aria-label="Promotion policies">
      <h2 className="mt-[18px] mb-2 text-[13px] font-semibold">Promotion policies</h2>
      {loading || fleet === undefined ? null : load.kind === "ok" ? (
        <Card className="overflow-x-auto">
          <table aria-label="Promotion policies" className="w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className={th}>Product</th>
                <th className={th}>From -&gt; to</th>
                <th className={th}>State</th>
                <th className={th}>Paused</th>
                <th className={th}>Reason</th>
                <th className={th}>Without evidence</th>
                <th className={th}>Policy</th>
                {token !== undefined && <th className={th} aria-label="Actions" />}
              </tr>
            </thead>
            <tbody>
              {load.rows.map((row) => {
                const open =
                  selected?.product === row.product && selected.channel === row.target_channel;
                return (
                  <PolicyRow key={`${row.product}/${row.target_channel}`} row={row}>
                    {token !== undefined && (
                      <td className={td}>
                        <Button
                          variant="ghost"
                          aria-pressed={open}
                          aria-label={`Detail ${row.product} ${row.target_channel}`}
                          onClick={() =>
                            setSelected(
                              open
                                ? undefined
                                : { product: row.product, channel: row.target_channel },
                            )
                          }
                        >
                          Detail
                        </Button>
                      </td>
                    )}
                  </PolicyRow>
                );
              })}
            </tbody>
          </table>
        </Card>
      ) : (
        <p className="m-0 text-xs">{EMPTY[load.kind]}</p>
      )}
      {token !== undefined && selected && load.kind === "ok" && (
        <Suspense fallback={null}>
          <PolicyDetail
            key={`${selected.product}/${selected.channel}`}
            token={token}
            product={selected.product}
            channel={selected.channel}
          />
        </Suspense>
      )}
    </section>
  );
};

const PolicyRow = ({ row, children }: { row: PolicyStatus; children?: ReactNode }) => {
  const missing = row.instances_without_evidence ?? [];
  return (
    <tr className="[&:last-child>td]:border-b-0">
      <td className={`${td} font-semibold`}>{row.product}</td>
      <td className={td}>
        {row.source_channel} -&gt; {row.target_channel}
      </td>
      <td className={`${td} ${STATE_TONE[row.state] ?? ""}`}>{row.state}</td>
      <td className={`${td} ${row.paused ? "text-warning" : ""}`}>
        {row.paused ? "paused" : "no"}
      </td>
      <td className={`${td} whitespace-normal`}>{row.reason ?? "·"}</td>
      <td className={`${td} whitespace-normal`}>
        {missing.length === 0 ? (
          "·"
        ) : (
          <ul aria-label="Instances without evidence" className="m-0 list-none p-0 text-warning">
            {missing.map((instance) => (
              <li key={instance} className="font-mono">
                {instance}
              </li>
            ))}
          </ul>
        )}
      </td>
      <td className={`${td} font-mono`}>
        {row.policy_id} v{row.policy_version}
      </td>
      {children}
    </tr>
  );
};
