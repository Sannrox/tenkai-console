import { parseInspectIssuer } from "../delivery/issuer";
import { Card } from "../ui/kit";

const th = "border-b border-line px-3.5 py-2 text-left font-medium whitespace-nowrap text-muted";
const td = "border-b border-line px-3.5 py-2 align-top";

const COPY = {
  unavailable: "This server does not report an identity issuer.",
  empty: "none",
} as const;

const ROTATION_TONE = {
  none: "text-muted",
  active: "text-ok",
  add: "text-warning",
  issue: "text-warning",
  remove: "text-warning",
  blocked: "text-warning",
} as const;

/**
 * Report-only workload identity issuer for the selected environment.
 * Inspect `identity_issuer`; Tenkai plans rotation, and this table does not.
 */
export const EnvironmentIssuer = ({ report }: { report: unknown }) => {
  const load = parseInspectIssuer(report);
  return (
    <>
      <h2 className="mt-[18px] mb-2 text-[13px] font-semibold">Identity issuer</h2>
      <Card className="overflow-x-auto">
        {load.kind === "unavailable" ? (
          <p className="m-0 px-3.5 py-3 text-xs text-muted">{COPY.unavailable}</p>
        ) : load.kind === "none" ? (
          <p className="m-0 px-3.5 py-3 text-xs text-muted">{COPY.empty}</p>
        ) : (
          <>
            <p className={`m-0 px-3.5 py-3 text-xs ${ROTATION_TONE[load.rotation]}`}>
              {load.rotation}
              {load.requested === "none" ? "" : ` · requested ${load.requested}`}
            </p>
            {load.slots.length > 0 && (
              <table className="w-full border-collapse text-xs" aria-label="Identity issuer">
                <thead>
                  <tr>
                    <th className={th}>Role</th>
                    <th className={th}>Fingerprint</th>
                    <th className={th}>Generation</th>
                    <th className={th}>Recipients</th>
                  </tr>
                </thead>
                <tbody>
                  {load.slots.map((slot) => (
                    <tr key={slot.role} className="[&:last-child>td]:border-b-0">
                      <td className={td}>{slot.role}</td>
                      <td className={`${td} font-mono`}>{slot.fingerprint}</td>
                      <td className={`${td} font-mono`}>{slot.generation}</td>
                      <td
                        className={`${td} font-mono ${slot.recipients === "lost" ? "text-warning" : ""}`}
                      >
                        {slot.recipients}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {load.waiting.length > 0 && (
              <ul className="m-0 list-none px-3.5 py-3 text-xs" aria-label="Waiting">
                {load.waiting.map((line) => (
                  <li key={line} className="text-warning">
                    {line}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Card>
    </>
  );
};

export default EnvironmentIssuer;
