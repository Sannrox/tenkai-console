import { useQuery } from "@tanstack/react-query";
import {
  Navigate,
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
} from "@tanstack/react-router";
import { checkServer, consoleRoot, fetchOidcSettings } from "./api/http";
import { signInWithHost } from "./auth/identity";
import { useSession } from "./auth/session";
import { useSessionRefresh } from "./auth/use-session-refresh";
import { Environments } from "./screens/environments";
import { findingSearch, objectEnvironment } from "./screens/objects";
import { ServerStatus } from "./screens/server-status";
import { SearchEntry } from "./screens/shell";
import { SignedIn } from "./screens/signed-in";
import { Centered, Title } from "./ui/kit";

// Screens other than the environments landing load on first visit, so the
// initial bundle stays small. Environments is eager: the fleet table must
// paint within the load budget.
const EnvironmentPage = lazyRouteComponent(
  () => import("./screens/environment-page"),
  "EnvironmentPage",
);
const PlanPage = lazyRouteComponent(() => import("./screens/plan-page"), "PlanPage");
const PlanByIdPage = lazyRouteComponent(() => import("./screens/plan-by-id"), "PlanByIdPage");
const ProductPage = lazyRouteComponent(() => import("./screens/product-page"), "ProductPage");
const ReleasePage = lazyRouteComponent(() => import("./screens/release-page"), "ReleasePage");
const RunnerPage = lazyRouteComponent(() => import("./screens/runner-page"), "RunnerPage");
const FindingPage = lazyRouteComponent(() => import("./screens/finding-page"), "FindingPage");
const Releases = lazyRouteComponent(() => import("./screens/releases"), "Releases");
const Runners = lazyRouteComponent(() => import("./screens/runners"), "Runners");
const Server = lazyRouteComponent(() => import("./screens/server"), "Server");
const Trust = lazyRouteComponent(() => import("./screens/trust"), "Trust");
const Operations = lazyRouteComponent(() => import("./screens/operations"), "Operations");
const Imports = lazyRouteComponent(() => import("./screens/imports"), "Imports");
const Access = lazyRouteComponent(() => import("./screens/access"), "Access");
const Exposure = lazyRouteComponent(() => import("./screens/exposure"), "Exposure");
const AuthCallback = lazyRouteComponent(() => import("./screens/auth-callback"), "AuthCallback");
const AttentionPage = lazyRouteComponent(() => import("./screens/attention"), "AttentionPage");
const MorePage = lazyRouteComponent(() => import("./screens/placeholders"), "MorePage");

const useServer = () =>
  useQuery({
    queryKey: ["server"],
    queryFn: async () => {
      const check = await checkServer();
      if (check.kind !== "ready") {
        return { check, oidc: null };
      }
      // Over an SSH forward to Tenkai's socket the connection is the sign-in.
      const { session, signIn } = useSession.getState();
      const [oidc] = await Promise.all([
        fetchOidcSettings(),
        session ? null : signInWithHost(signIn).catch(() => false),
      ]);
      return { check, oidc };
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

const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  component: Environments,
});

const environmentSearch = (search: Record<string, unknown>): { instance?: string } => {
  const instance = typeof search.instance === "string" ? search.instance : undefined;
  return instance === undefined ? {} : { instance };
};

const planRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/environments/$environment/plan",
  component: function Plan() {
    const { environment } = planRoute.useParams();
    const token = useSession((state) => state.session?.accessToken);
    return token !== undefined ? <PlanPage environment={environment} token={token} /> : null;
  },
});

const environmentRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/environments/$environment",
  validateSearch: environmentSearch,
  component: EnvironmentPage,
});

const environmentInstancesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/environments/$environment/instances",
  validateSearch: environmentSearch,
  component: EnvironmentPage,
});

const environmentHistoryRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/environments/$environment/history",
  validateSearch: environmentSearch,
  component: EnvironmentPage,
});

const environmentSettingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/environments/$environment/settings",
  validateSearch: environmentSearch,
  component: EnvironmentPage,
});

const environmentSecurityRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/environments/$environment/security",
  validateSearch: environmentSearch,
  component: EnvironmentPage,
});

const environmentLinkedRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/environments/$environment/linked",
  validateSearch: environmentSearch,
  component: EnvironmentPage,
});

const environmentsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/environments",
  validateSearch: (
    search: Record<string, unknown>,
  ): { environment?: string; instance?: string } => {
    const environment = typeof search.environment === "string" ? search.environment : undefined;
    const instance = typeof search.instance === "string" ? search.instance : undefined;
    return {
      ...(environment === undefined ? {} : { environment }),
      ...(instance === undefined ? {} : { instance }),
    };
  },
  component: function EnvironmentsRedirect() {
    const { environment, instance } = environmentsRoute.useSearch();
    if (environment !== undefined) {
      return (
        <Navigate
          to={
            instance === undefined
              ? "/environments/$environment"
              : "/environments/$environment/history"
          }
          params={{ environment }}
          search={instance === undefined ? {} : { instance }}
          replace
        />
      );
    }
    return <Navigate to="/" replace />;
  },
});

const productSearch = objectEnvironment;

const productRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/products/$product",
  validateSearch: productSearch,
  component: ProductPage,
});

const productLinkedRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/products/$product/linked",
  validateSearch: productSearch,
  component: ProductPage,
});

const releaseObjectRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/releases/$product/$version",
  validateSearch: productSearch,
  component: ReleasePage,
});

const releaseLinkedRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/releases/$product/$version/linked",
  validateSearch: productSearch,
  component: ReleasePage,
});

const releasesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/releases",
  component: Releases,
});

const runnerObjectRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/runners/$runnerId",
  component: RunnerPage,
});

const runnerLinkedRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/runners/$runnerId/linked",
  component: RunnerPage,
});

const planByIdRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/plans/$planId",
  validateSearch: productSearch,
  component: PlanByIdPage,
});

const findingRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/findings/$advisory",
  validateSearch: findingSearch,
  component: FindingPage,
});

const findingLinkedRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/findings/$advisory/linked",
  validateSearch: findingSearch,
  component: FindingPage,
});

const exposureRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/exposure",
  component: Exposure,
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

const searchRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/search",
  component: SearchEntry,
});

const attentionRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/attention",
  component: AttentionPage,
});

const appsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/apps",
  component: MorePage,
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
      environmentRoute,
      environmentInstancesRoute,
      environmentHistoryRoute,
      environmentSettingsRoute,
      environmentSecurityRoute,
      environmentLinkedRoute,
      environmentsRoute,
      productRoute,
      productLinkedRoute,
      releaseObjectRoute,
      releaseLinkedRoute,
      releasesRoute,
      runnerObjectRoute,
      runnerLinkedRoute,
      planByIdRoute,
      findingRoute,
      findingLinkedRoute,
      exposureRoute,
      runnersRoute,
      serverRoute,
      trustRoute,
      importsRoute,
      operationsRoute,
      accessRoute,
      searchRoute,
      attentionRoute,
      appsRoute,
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
