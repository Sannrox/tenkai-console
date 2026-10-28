import type { InstalledRevocations, TrustPosture } from "../api/tenkai.gen";
import { useSession } from "../auth/session";
import {
  byExpiry,
  describeCertificate,
  firstExpiry,
  onDiskRoots,
  signerRows,
} from "../delivery/transport";
import { Button, Card } from "../ui/kit";
import { RefreshFailed, STATUS_TONE, td, th, useTrustPosture } from "../ui/posture";

/**
 * The 2026-10-28 pick A (#36): a runway banner, then signing trust and TLS
 * certificates as two tables, the revocation list under the signing table.
 * A top-level tab of its own (#34). Tenkai reports no per-plan runway, no
 * signer expiry and no revocation import time, so none of those is shown.
 */
export const Trust = () => {
  const token = useSession((state) => state.session?.accessToken);
  const trust = useTrustPosture(token);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="m-0 text-lg font-semibold">Trust</h1>
        <Button variant="ghost" className="ml-auto" onClick={() => void trust.refetch()}>
          Refresh
        </Button>
      </div>
      <RefreshFailed queries={[["trust", trust]]} />
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
  const first = firstExpiry(posture);
  const signers = signerRows(posture.signing);
  const certificates = byExpiry(posture.tls);
  return (
    <>
      <Card className="mb-3 px-3.5 py-2 text-xs">
        {first ? (
          <div className={STATUS_TONE[first.status]}>
            Credential runway: {first.purpose} {describeCertificate(first)}
          </div>
        ) : (
          <div>Credential runway: every certificate is beyond its warning threshold</div>
        )}
        <div className="text-muted">
          Which scheduled plan it blocks is not reported by this server.
        </div>
      </Card>
      <h2 className="m-0 mb-2 text-sm font-semibold">Signing trust</h2>
      {onDiskRoots(posture.signing).map((root) => (
        <p key={`${root.purpose}|${root.file}`} className="m-0 mb-1 text-xs">
          {root.purpose} ({root.file}): As on disk now. The server adopts changes after a restart.
        </p>
      ))}
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
        : `Revocation list sequence ${list.sequence ?? "unknown"}, ${list.revoked_keys} revoked keys, signed by ${list.signer_key_id ?? "unknown"}. Import time not reported.`}
  </p>
);
