import { Outlet } from "@tanstack/react-router";
import { useEffect } from "react";
import { ApiError } from "../api/http";
import type { OidcClientDiscovery } from "../api/tenkai.gen";
import { useSession } from "../auth/session";
import { useSignOut } from "../auth/use-sign-out";
import { useDelivery } from "../delivery/use-delivery";
import { Button, Centered, Title } from "../ui/kit";
import { FirstAdministratorBanner } from "./first-administrator";
import { SignIn } from "./sign-in";
import { TopBar } from "./top-bar";

/** Every signed-in screen: sign-in gate, expired and no-access states, top bar. */
export const SignedIn = ({ settings }: { settings: OidcClientDiscovery | null }) => {
  const session = useSession((state) => state.session);
  const signOut = useSession((state) => state.signOut);
  const leave = useSignOut(settings);
  const delivery = useDelivery(session?.accessToken);
  const status = delivery.error instanceof ApiError ? delivery.error.status : undefined;

  useEffect(() => {
    if (status === 401) {
      signOut("expired");
    }
  }, [status, signOut]);

  if (!session) {
    return <SignIn settings={settings} />;
  }
  if (status === 403) {
    return (
      <Centered>
        {/* On a hub with no first administrator nobody has access yet; the
            management token, not this account, authorizes the setup. */}
        <FirstAdministratorBanner />
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
  return (
    <div className="min-h-screen bg-surface">
      <TopBar session={session} settings={settings} />
      <main className="px-6 py-5">
        <FirstAdministratorBanner />
        <Outlet />
      </main>
    </div>
  );
};
