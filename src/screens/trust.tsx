import { useQuery } from "@tanstack/react-query";
import { request } from "../api/http";
import type { InstalledRevocations, PlanRunways, TrustPosture } from "../api/tenkai.gen";
import { useSession } from "../auth/session";
import {
  byExpiry,
  describeCertificate,
  firstBlocked,
  signerRows,
  startupRoots,
} from "../delivery/transport";
import { Button, Card } from "../ui/kit";
import { RefreshFailed, STATUS_TONE, td, th, useTrustPosture } from "../ui/posture";

/**
 * The 2026-10-28 pick A (#36): a runway banner naming the first plan a
 * lapsing certificate blocks, then signing trust and TLS certificates as two
 * tables, the revocation list under the signing table. A top-level tab of its
 * own (#34). Trust roots record no signer validity (Sannrox/tenkai#812), so
 * signers have no expiry and the signing table is not sorted by one.
 */
export const Trust = () => {
  const token = useSession((state) => state.session?.accessToken);
  const trust = useTrustPosture(token);
  const runway = useQuery({
    queryKey: ["trust-runway", token],
    queryFn: () => request<PlanRunways>("v1/trust/runway", { token }),
    enabled: token !== undefined,
    retry: false,
  });
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="m-0 text-lg font-semibold">Trust</h1>
        <Button
          variant="ghost"
          className="ml-auto"
          onClick={() => void Promise.all([trust.refetch(), runway.refetch()])}
        >
          Refresh
        </Button>
      </div>
      <RefreshFailed
        queries={[
          ["trust", trust],
          ["runway", runway],
        ]}
      />
      {runway.data ? (
        <Runway runways={runway.data} />
      ) : (
        <p aria-label="Runway" className="m-0 mb-3 text-xs text-muted">
          Runway: {runway.error ? runway.error.message : "Loading"}
        </p>
      )}
      {trust.data ? (
        <Posture posture={trust.data} />
      ) : (
        <Card className="px-3.5 py-2 text-xs text-muted">
          {trust.error ? trust.error.message : "Loading"}
        </Card>
      )}
    </>
  );
};

const SIGNER_TONE = { bad: "text-danger", warning: "text-warning", ok: "" } as const;

const SOURCE_LABEL = { loaded: "loaded", file: "on disk" } as const;

const Posture = ({ posture }: { posture: TrustPosture }) => {
  const signers = signerRows(posture.signing);
  const certificates = byExpiry(posture.tls);
  return (
    <>
      <h2 className="m-0 mb-2 text-sm font-semibold">Signing trust</h2>
      {startupRoots(posture.signing).map((root) => (
        <p key={`${root.purpose}|${root.file}`} className="m-0 mb-1 text-xs">
          {root.purpose} ({root.file}): Loaded at startup; changes apply after a restart.
        </p>
      ))}
      {posture.signing.some((root) => root.signer_validity === "not_recorded") && (
        <p className="m-0 mb-1 text-xs text-muted">
          Signer validity is not recorded in trust roots.
        </p>
      )}
      <Card className="mb-3 overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className={th}>Purpose</th>
              <th className={th}>Signer</th>
              <th className={th}>Key</th>
              <th className={th}>Source</th>
              <th className={th}>State</th>
            </tr>
          </thead>
          <tbody>
            {posture.signing.length === 0 ? (
              <tr>
                <td className={`${td} text-muted`} colSpan={5}>
                  No trust roots configured
                </td>
              </tr>
            ) : (
              signers.map((row) => (
                <tr key={`${row.purpose}|${row.keyId}|${row.state}`}>
                  <td className={td} title={row.file}>
                    {row.purpose}
                  </td>
                  <td className={td}>{row.identity}</td>
                  <td className={`${td} font-mono`}>{row.keyId}</td>
                  <td className={`${td} text-muted`}>
                    {row.sources.map((source) => SOURCE_LABEL[source]).join(", ")}
                  </td>
                  <td className={`${td} ${SIGNER_TONE[row.tone]}`}>{row.state}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <Revocations list={posture.revocation_list} />
      </Card>
      <h2 className="m-0 mb-2 text-sm font-semibold">TLS certificates</h2>
      <Card className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className={th}>Purpose</th>
              <th className={th}>Certificate</th>
              <th className={th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {certificates.length === 0 ? (
              <tr>
                <td className={`${td} border-b-0 text-muted`} colSpan={3}>
                  No certificates configured
                </td>
              </tr>
            ) : (
              certificates.map((certificate) => (
                <tr
                  key={`${certificate.purpose}|${certificate.subject ?? ""}|${certificate.not_after ?? ""}`}
                  className="[&:last-child>td]:border-b-0"
                >
                  <td className={td} title={certificate.file}>
                    {certificate.purpose}
                  </td>
                  <td className={`${td} ${STATUS_TONE[certificate.status]}`}>
                    {describeCertificate(certificate)}
                  </td>
                  <td className={`${td} ${STATUS_TONE[certificate.status]}`}>
                    {certificate.status}
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

/** The installed key revocation list, under the signing table. */
const Revocations = ({ list }: { list: InstalledRevocations | undefined }) => (
  <p
    aria-label="Revocation list"
    className={`m-0 px-3.5 py-2 text-xs ${list?.error ? "text-danger" : "text-muted"}`}
  >
    {list === undefined
      ? "Revocation list: none installed"
      : list.error
        ? `Revocation list ${list.file}: ${list.error}`
        : [
            `Revocation list sequence ${list.sequence ?? "unknown"}, ${list.revoked_keys} revoked keys, signed by ${list.signer_key_id ?? "unknown"}`,
            list.issued_at === undefined ? undefined : `issued ${iso(list.issued_at)}`,
            list.installed_at === undefined ? undefined : `file written ${iso(list.installed_at)}`,
          ]
            .filter(Boolean)
            .join(", ")}
  </p>
);

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * The first waiting plan a certificate lapse blocks, in bad colour: it
 * would fail when its window opens. Nothing when no plan is blocked.
 */
const Runway = ({ runways }: { runways: PlanRunways }) => {
  const plan = firstBlocked(runways);
  if (!plan) {
    return null;
  }
  return (
    <Card aria-label="Credential runway" className="mb-3 px-3.5 py-2 text-xs text-danger">
      Plan <span className="font-mono">{plan.plan_id}</span> for {plan.environment} waits for the
      window opening {iso(plan.blocked_by.window_opens_at_ms)}, but {plan.blocked_by.credential}{" "}
      expires {iso(plan.blocked_by.expires_at_ms)}.
    </Card>
  );
};
