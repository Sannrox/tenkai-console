import { useQuery } from "@tanstack/react-query";
import { Outlet, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { checkServer, consoleRoot, fetchOidcSettings } from "./api/http";
import { useSession } from "./auth/session";
import { useSessionRefresh } from "./auth/use-session-refresh";
import { Access } from "./screens/access";
import { AuthCallback } from "./screens/auth-callback";
import { Environments } from "./screens/environments";
import { Home } from "./screens/home";
import { PlanPage } from "./screens/plan-page";
import { Releases } from "./screens/releases";
import { ServerStatus } from "./screens/server-status";
import { SignedIn } from "./screens/signed-in";
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

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  component: function App() {
    return <SignedIn settings={useServer().data?.oidc ?? null} />;
  },
});

const indexRoute = createRoute({ getParentRoute: () => appRoute, path: "/", component: Home });

const planRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/environments/$environment/plan",
  component: function Plan() {
    const { environment } = planRoute.useParams();
    const token = useSession((state) => state.session?.accessToken);
    return token ? <PlanPage environment={environment} token={token} /> : null;
  },
});

const environmentsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/environments",
  component: Environments,
});

const releasesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/releases",
  component: Releases,
});

const accessRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/access",
  component: function AccessPage() {
    return <Access settings={useServer().data?.oidc ?? null} />;
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
  routeTree: rootRoute.addChildren([
    appRoute.addChildren([indexRoute, planRoute, environmentsRoute, releasesRoute, accessRoute]),
    callbackRoute,
  ]),
  basepath: consoleRoot.pathname,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
