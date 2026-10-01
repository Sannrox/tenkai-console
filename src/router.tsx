import { useQuery } from "@tanstack/react-query";
import { Outlet, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { checkServer, consoleRoot, fetchOidcSettings } from "./api/http";
import { useSession } from "./auth/session";
import { useSessionRefresh } from "./auth/use-session-refresh";
import { AuthCallback } from "./screens/auth-callback";
import { Home } from "./screens/home";
import { PlanPage } from "./screens/plan-page";
import { ServerStatus } from "./screens/server-status";
import { SignIn } from "./screens/sign-in";
import { Centered, Title } from "./ui/kit";

const useServer = () =>
  useQuery({
    queryKey: ["server"],
    queryFn: async () => {
      const check = await checkServer();
      return check.kind === "ready"
        ? { check, oidc: await fetchOidcSettings() }
        : { check, oidc: null };
    },
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

/** Gate every screen on a reachable, compatible server. */
const Root = () => {
  const server = useServer();
  useSessionRefresh(server.data?.oidc ?? null);
  if (!server.data) {
    return (
      <Centered>
        <Title subtitle={server.error ? `Could not load: ${server.error.message}` : "Connecting"} />
      </Centered>
    );
  }
  if (server.data.check.kind !== "ready") {
    return <ServerStatus check={server.data.check} />;
  }
  return <Outlet />;
};

const rootRoute = createRootRoute({ component: Root });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: function Index() {
    const settings = useServer().data?.oidc ?? null;
    const session = useSession((state) => state.session);
    return session ? (
      <Home session={session} settings={settings} />
    ) : (
      <SignIn settings={settings} />
    );
  },
});

const planRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/environments/$environment/plan",
  component: function Plan() {
    const { environment } = planRoute.useParams();
    const settings = useServer().data?.oidc ?? null;
    const session = useSession((state) => state.session);
    return session ? (
      <PlanPage environment={environment} session={session} settings={settings} />
    ) : (
      <SignIn settings={settings} />
    );
  },
});

const callbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/auth/callback",
  component: function Callback() {
    const settings = useServer().data?.oidc ?? null;
    return settings ? (
      <AuthCallback settings={settings} />
    ) : (
      <Centered>
        <Title subtitle="This server has no OIDC sign-in." />
      </Centered>
    );
  },
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, planRoute, callbackRoute]),
  basepath: consoleRoot.pathname,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
