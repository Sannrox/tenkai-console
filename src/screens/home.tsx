import { useEffect } from "react";
import { ApiError } from "../api/http";
import type { OidcClientDiscovery } from "../api/tenkai.gen";
import { type Session, useSession } from "../auth/session";
import { useSignOut } from "../auth/use-sign-out";
import { attention } from "../delivery/model";
import { useDelivery } from "../delivery/use-delivery";
import { Button, Centered, Title } from "../ui/kit";
import { Delivery } from "./delivery";
import { TopBar } from "./top-bar";

/** Signed-in landing: the delivery matrix (decision 2B). */
export const Home = ({
  session,
  settings,
}: {
  session: Session;
  settings: OidcClientDiscovery | null;
}) => {
  const signOut = useSession((state) => state.signOut);
  const leave = useSignOut(settings);
  const delivery = useDelivery(session.accessToken);
  const status = delivery.error instanceof ApiError ? delivery.error.status : undefined;

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

  const needs = attention(delivery.reports).length;
  return (
    <div className="min-h-screen bg-surface">
      <TopBar active="Delivery" session={session} settings={settings} />
      <main className="px-6 py-5">
        <div className="mb-4 flex items-center gap-3">
          <h1 className="m-0 text-lg font-semibold">Delivery</h1>
          <span className="text-xs text-muted">
            {delivery.error
              ? delivery.error.message
              : delivery.loading
                ? "Loading"
                : needs === 0
                  ? `${delivery.reports.length} environments, all current`
                  : `${needs} need attention`}
          </span>
        </div>
        {!delivery.loading && !delivery.error && <Delivery reports={delivery.reports} />}
      </main>
    </div>
  );
};
