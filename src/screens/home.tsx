import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { ApiError, request } from "../api/http";
import type { FleetStatusReport, OidcClientDiscovery } from "../api/tenkai.gen";
import { type Session, useSession } from "../auth/session";
import { useSignOut } from "../auth/use-sign-out";
import { Button, Centered, Title } from "../ui/kit";
import { TopBar } from "./top-bar";

/** Signed-in landing. The matrix (decision 2B) arrives with console#2. */
export const Home = ({
  session,
  settings,
}: {
  session: Session;
  settings: OidcClientDiscovery | null;
}) => {
  const signOut = useSession((state) => state.signOut);
  const leave = useSignOut(settings);
  const fleet = useQuery({
    queryKey: ["fleet", session.accessToken],
    queryFn: () => request<FleetStatusReport>("v1/fleet/status", { token: session.accessToken }),
    retry: false,
  });
  const status = fleet.error instanceof ApiError ? fleet.error.status : undefined;

  useEffect(() => {
    if (status === 401) {
      signOut("expired");
    }
  }, [status, signOut]);

  if (status === 403) {
    return (
      <Centered>
        <Title subtitle="Signed in, no access" />
        <p className="m-0 text-xs text-warning">
          {session.subject ?? "This account"} has no Tenkai access. Ask the platform team.
        </p>
        <Button className="mt-4" onClick={() => void leave()}>
          Sign out
        </Button>
      </Centered>
    );
  }

  const report = fleet.data;
  return (
    <div className="min-h-screen bg-surface">
      <TopBar active="Delivery" session={session} settings={settings} />
      <main className="px-6 py-5">
        <div className="mb-4 flex items-center gap-3">
          <h1 className="m-0 text-lg font-semibold">Delivery</h1>
          <span className="text-xs text-muted">
            {report
              ? `${report.environment_count} environments, ${report.environments_unhealthy} unhealthy, ${report.environments_behind} behind`
              : fleet.error
                ? fleet.error.message
                : "Loading"}
          </span>
        </div>
      </main>
    </div>
  );
};
