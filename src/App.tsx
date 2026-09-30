import { useEffect, useState } from "react";
import { apiBase, fetchHealth, type HealthResult } from "./api";

const base = apiBase(import.meta.url, import.meta.env.DEV);

/** Shell page: server reachability only. Screens land in later issues. */
export const App = () => {
  const [health, setHealth] = useState<HealthResult>();

  useEffect(() => {
    void fetchHealth(base).then(setHealth);
  }, []);

  return (
    <main>
      <h1>tenkai</h1>
      {health === undefined && <p>connecting</p>}
      {health?.kind === "reachable" && (
        <p>
          {health.health.status} · {health.health.profile}
        </p>
      )}
      {health?.kind === "unreachable" && <p role="alert">unreachable: {health.reason}</p>}
    </main>
  );
};
