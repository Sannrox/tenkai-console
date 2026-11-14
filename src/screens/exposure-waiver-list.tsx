import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { fetchWaivers, minuteUtc, scopeLabel, waiverState } from "../delivery/waivers";
import { Card } from "../ui/kit";
import { td, th } from "../ui/posture";

const COPY = {
  unavailable: "This server does not list waivers.",
  forbidden: "No access",
  error: "Could not load",
} as const;

const MARK = {
  none: { text: "expired", tone: "text-muted" },
  expiring: { text: "expiring soon", tone: "text-warning" },
  active: { text: "", tone: "" },
} as const;

/**
 * Every stored waiver on the Exposure screen, whether or not it matches a
 * finding today. Expired waivers stay stored until cleared; the server lists
 * them only when Include expired asks for them. Loaded lazily with the screen
 * and refreshed by every settled waiver write (the `exposures` query key).
 */
const WaiverList = ({ token }: { token: string }) => {
  const [expired, setExpired] = useState(false);
  const query = useQuery({
    queryKey: ["exposures", "waivers", token, expired],
    queryFn: () => fetchWaivers(expired, token),
    retry: false,
  });
  const [now, setNow] = useState(() => Date.now());
  // Same clock as Findings, so a waiver that lapses on screen reads as expired in both.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(tick);
  }, []);
  const load = query.data;
  return (
    <section aria-label="Waivers">
      <div className="mt-[18px] mb-2 flex flex-wrap items-center gap-3">
        <h2 className="m-0 text-[13px] font-semibold">Waivers</h2>
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={expired}
            onChange={(event) => setExpired(event.target.checked)}
          />
          Include expired
        </label>
      </div>
      {load === undefined || load.kind !== "ok" ? (
        <p className="m-0 text-xs text-muted">{load === undefined ? "Loading" : COPY[load.kind]}</p>
      ) : (
        <Card className="overflow-x-auto">
          <table aria-label="Waivers" className="w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className={th}>Advisory</th>
                <th className={th}>Scope</th>
                <th className={th}>Category</th>
                <th className={th}>Reason</th>
                <th className={th}>Actor</th>
                <th className={th}>Expires</th>
              </tr>
            </thead>
            <tbody>
              {load.waivers.length === 0 ? (
                <tr>
                  <td className={`${td} text-muted`} colSpan={6}>
                    no waivers
                  </td>
                </tr>
              ) : (
                load.waivers.map((waiver) => {
                  const mark = MARK[waiverState(waiver, now)];
                  return (
                    <tr
                      key={`${waiver.advisory_id}|${waiver.scope}|${waiver.release_id ?? ""}|${waiver.component ?? ""}|${waiver.product ?? ""}`}
                    >
                      <td className={`${td} font-mono`}>{waiver.advisory_id}</td>
                      <td className={`${td} font-mono`}>{scopeLabel(waiver.scope, waiver)}</td>
                      <td className={td}>{waiver.category.replaceAll("_", " ")}</td>
                      <td className={`${td} whitespace-normal`}>{waiver.reason}</td>
                      <td className={td}>{waiver.actor}</td>
                      <td className={`${td} ${mark.tone}`}>
                        {mark.text && `${mark.text} · `}
                        {minuteUtc(waiver.expires_at)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </Card>
      )}
    </section>
  );
};

export default WaiverList;
