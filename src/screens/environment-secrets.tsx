import { useQuery } from "@tanstack/react-query";
import { fetchSealedSecrets, secretRows } from "../delivery/sealed-secrets";
import { Card } from "../ui/kit";

const th = "border-b border-line px-3.5 py-2 text-left font-medium whitespace-nowrap text-muted";
const td = "border-b border-line px-3.5 py-2 align-top";
const TONE = {
  ok: "text-ok",
  warn: "text-warning",
  bad: "text-danger",
  muted: "text-muted",
} as const;

const COPY = {
  unavailable: "This server does not report sealed secrets.",
  forbidden: "No access",
  empty: "none",
  loading: "Loading",
} as const;

/**
 * Sealed secret names, ages, and rotation state for one environment, overdue
 * first. Never a value. GET `/v1/environments/{environment}/sealed-secrets`.
 */
export const EnvironmentSecrets = ({
  environment,
  token,
}: {
  environment: string;
  token: string;
}) => {
  const query = useQuery({
    queryKey: ["sealed-secrets", environment, token],
    queryFn: () => fetchSealedSecrets(environment, token),
    retry: false,
  });
  const load = query.data;
  const rows = load?.kind === "ok" ? secretRows(load.value) : [];
  const overdue = rows.filter((row) => row.state === "overdue").length;

  let body;
  if (load === undefined) {
    body = <p className="m-0 px-3.5 py-3 text-xs text-muted">{COPY.loading}</p>;
  } else if (load.kind === "unavailable" || load.kind === "forbidden") {
    body = <p className="m-0 px-3.5 py-3 text-xs text-muted">{COPY[load.kind]}</p>;
  } else if (load.kind === "error") {
    body = (
      <p role="alert" className="m-0 px-3.5 py-3 text-xs text-danger">
        {load.message}
      </p>
    );
  } else if (rows.length === 0) {
    body = <p className="m-0 px-3.5 py-3 text-xs text-muted">{COPY.empty}</p>;
  } else {
    body = (
      <table className="w-full border-collapse text-xs" aria-label="Sealed secrets">
        <thead>
          <tr>
            <th className={th}>Secret</th>
            <th className={th}>Instance</th>
            <th className={th}>State</th>
            <th className={th}>Age</th>
            <th className={th}>Rotate after</th>
            <th className={th}>Set by</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.name}:${row.instance}`} className="[&:last-child>td]:border-b-0">
              <td className={`${td} font-mono`}>{row.name}</td>
              <td className={`${td} font-mono`}>{row.instance}</td>
              <td className={`${td} whitespace-nowrap ${TONE[row.tone]}`}>{row.state}</td>
              <td className={`${td} font-mono`}>{row.age}</td>
              <td className={`${td} font-mono ${row.rotateAfter === "none" ? "text-muted" : ""}`}>
                {row.rotateAfter}
              </td>
              <td className={td}>{row.setBy}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <section aria-label="Sealed secrets" className="min-w-0">
      <div className="mt-[18px] mb-2 flex items-baseline gap-2">
        <h2 className="m-0 text-[13px] font-semibold">Sealed secrets</h2>
        {overdue > 0 && (
          <span className="text-[13px] font-medium text-warning">{overdue} overdue</span>
        )}
      </div>
      <Card className="overflow-x-auto">{body}</Card>
    </section>
  );
};

export default EnvironmentSecrets;
