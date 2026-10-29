import { useQuery } from "@tanstack/react-query";
import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
} from "@tanstack/react-router";
import { checkServer, consoleRoot, fetchOidcSettings } from "./api/http";
import { useSession } from "./auth/session";
import { useSessionRefresh } from "./auth/use-session-refresh";
import { Environments } from "./screens/environments";
import { Home } from "./screens/home";
import { ServerStatus } from "./screens/server-status";
import { SignedIn } from "./screens/signed-in";
import { Centered, Title } from "./ui/kit";

// Screens other than home load on first visit, so the initial bundle stays small.
// Environments is eager: the fleet table must paint within the load budget.
const PlanPage = lazyRouteComponent(() => import("./screens/plan-page"), "PlanPage");
const Releases = lazyRouteComponent(() => import("./screens/releases"), "Releases");
const Runners = lazyRouteComponent(() => import("./screens/runners"), "Runners");
const Server = lazyRouteComponent(() => import("./screens/server"), "Server");
const Trust = lazyRouteComponent(() => import("./screens/trust"), "Trust");
const Operations = lazyRouteComponent(() => import("./screens/operations"), "Operations");
const Imports = lazyRouteComponent(() => import("./screens/imports"), "Imports");
const Access = lazyRouteComponent(() => import("./screens/access"), "Access");
const AuthCallback = lazyRouteComponent(() => import("./screens/auth-callback"), "AuthCallback");

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
  validateSearch: (search: Record<string, unknown>): { environment?: string } => {
    const environment = typeof search.environment === "string" ? search.environment : undefined;
    return environment === undefined ? {} : { environment };
  },
  component: function EnvironmentsPage() {
    const { environment } = environmentsRoute.useSearch();
    return environment === undefined ? <Environments /> : <Environments focus={environment} />;
  },
});

const releasesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/releases",
  component: Releases,
});

const runnersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/runners",
  component: Runners,
});

const serverRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/server",
  component: Server,
});

const trustRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/trust",
  component: Trust,
});

const operationsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/operations",
  component: Operations,
});

const importsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/imports",
  component: Imports,
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
    appRoute.addChildren([
      indexRoute,
      planRoute,
      environmentsRoute,
      releasesRoute,
      runnersRoute,
      serverRoute,
      trustRoute,
      importsRoute,
      operationsRoute,
      accessRoute,
    ]),
    callbackRoute,
  ]),
  basepath: consoleRoot.pathname,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
