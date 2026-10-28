import { useQuery } from "@tanstack/react-query";
import { request } from "../api/http";
import type {
  CertificateEntry,
  EnvironmentListEntry,
  RuntimeRunnerList,
  TrustPosture,
} from "../api/tenkai.gen";
import { useSession } from "../auth/session";
import {
  describeCertificate,
  environmentAuth,
  hubTransport,
  type HubTransport,
} from "../delivery/transport";
import { Button, Card, Notice } from "../ui/kit";

const th = "border-b border-line px-3.5 py-2 text-left font-medium whitespace-nowrap text-muted";
const td = "border-b border-line px-3.5 py-2 align-top whitespace-nowrap";

const STATUS_TONE: Record<string, string> = {
  ok: "",
  warning: "text-warning",
  critical: "text-danger",
  expired: "text-danger",
};

/**
 * The 2026-10-28 pick B (#39): hub transport facts, then one row per
 * environment with its runner count and static bearer tokens. A top-level
 * tab of its own (#34); `server-status.tsx` stays the unreachable-hub panel.
 */
export const Server = () => {
  const token = useSession((state) => state.session?.accessToken);
  const trust = useQuery({
    queryKey: ["trust", token],
    queryFn: () => request<TrustPosture>("v1/trust", { token }),
    enabled: token !== undefined,
    retry: false,
  });
  // Same keys and requests as the Runners screen, so the cache is shared.
  const runners = useQuery({
    queryKey: ["runners", token],
    queryFn: () => request<RuntimeRunnerList>("v1/runners", { token }),
    enabled: token !== undefined,
    retry: false,
  });
  const environments = useQuery({
    queryKey: ["environments", token],
    queryFn: () => request<EnvironmentListEntry[]>("v1/environments", { token }),
    enabled: token !== undefined,
    retry: false,
  });
  // The table needs both lists: without the registry every count would read
  // zero, and without the environment list environments with no runner vanish.
  // Data a later refresh failed to replace stays, with a notice above.
  const pending =
    runners.data && environments.data
      ? undefined
      : (runners.error?.message ?? environments.error?.message ?? "Loading");
  const rows =
    runners.data && environments.data
      ? environmentAuth(
          runners.data.runners,
          environments.data.map((entry) => entry.name),
        )
      : [];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="m-0 text-lg font-semibold">Server</h1>
        <Button
          variant="ghost"
          className="ml-auto"
          onClick={() =>
            void Promise.all([trust.refetch(), runners.refetch(), environments.refetch()])
          }
        >
          Refresh
        </Button>
      </div>
      {(
        [
          ["trust", trust],
          ["runners", runners],
          ["environments", environments],
        ] as const
      ).map(([name, query]) =>
        query.error && query.data !== undefined ? (
          <div key={name} className="mb-3">
            <Notice tone="bad">
              Refresh failed: {query.error.message}. Showing data from{" "}
              {new Date(query.dataUpdatedAt).toISOString()}.
            </Notice>
          </div>
        ) : null,
      )}
      <Card className="mb-3 overflow-x-auto">
        {trust.data ? (
          <Facts transport={hubTransport(trust.data)} />
        ) : (
          <p className="m-0 px-3.5 py-2 text-xs text-muted">
            {trust.error ? trust.error.message : "Loading"}
          </p>
        )}
      </Card>
      <Card className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className={th}>Environment</th>
              <th className={th}>Runners</th>
              <th className={th}>Static bearer tokens</th>
            </tr>
          </thead>
          <tbody>
            {pending !== undefined ? (
              <tr>
                <td className={`${td} border-b-0 text-muted`} colSpan={3}>
                  {pending}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.environment} className="[&:last-child>td]:border-b-0">
                  <td className={td}>{row.environment}</td>
                  <td className={`${td} ${row.runners === 0 ? "text-muted" : ""}`}>
                    {row.runners}
                  </td>
                  <td className={`${td} ${row.bearer > 0 ? "text-warning" : "text-muted"}`}>
                    {row.bearer}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </>
  );
};

/** One line per certificate, coloured by its status. */
const Certificates = ({ certificates }: { certificates: CertificateEntry[] }) =>
  certificates.map((certificate) => (
    <div
      // Subject and expiry tell certificates of one source apart.
      key={`${certificate.subject ?? ""}|${certificate.not_after ?? ""}|${certificate.error ?? ""}`}
      className={STATUS_TONE[certificate.status] ?? ""}
    >
      {describeCertificate(certificate)}
    </div>
  ));

const Facts = ({ transport }: { transport: HubTransport }) => (
  <table className="w-full border-collapse text-xs">
    <tbody>
      <tr>
        <th className={th}>TLS</th>
        <td className={td}>
          <div>{transport.tls}</div>
          <Certificates certificates={transport.listener} />
        </td>
      </tr>
      <tr>
        <th className={th}>Runner client certificates</th>
        <td className={td}>
          <div className={transport.clientCa.length > 0 ? "" : "text-muted"}>
            {transport.clientCa.length > 0 ? "verified when presented" : "not accepted"}
          </div>
          <Certificates certificates={transport.clientCa} />
        </td>
      </tr>
      <tr className="[&>*]:border-b-0">
        <th className={th}>Runner CA</th>
        <td className={td}>
          {transport.runnerCa.length > 0 ? (
            <Certificates certificates={transport.runnerCa} />
          ) : (
            <span className="text-muted">none</span>
          )}
        </td>
      </tr>
    </tbody>
  </table>
);
