import { Link, useRouterState } from "@tanstack/react-router";
import { lazy, Suspense, type ReactNode, useEffect, useState } from "react";
import type { OidcClientDiscovery } from "../api/tenkai.gen";
import { HOST_SIGN_OUT, signInMethod } from "../auth/identity";
import type { Session } from "../auth/session";
import { useSignOut } from "../auth/use-sign-out";
import { Button, tabClass } from "../ui/kit";
import {
  APP_ITEMS,
  MAIN_ITEMS,
  PHONE_ITEMS,
  PLATFORM_TABS,
  activeMain,
  appItemActive,
  isPlatformPath,
  readCollapsed,
  writeCollapsed,
} from "./nav";

const QuickSearch = lazy(() =>
  import("./quick-search").then((mod) => ({ default: mod.QuickSearch })),
);

const ICONS: Record<string, string> = {
  search: "M11.5 11.5 14 14M7 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10Z",
  home: "M2.5 7.5 8 2.5l5.5 5V14H9.5V9.5h-3V14H2.5Z",
  attention: "M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12ZM8 5v3.5M8 11h.01",
  environments: "M2.5 2.5h5v5h-5Zm6 0h5v5h-5Zm-6 6h5v5h-5Zm6 0h5v5h-5Z",
  releases: "M3 3.5h10v3H3Zm0 5h10v4.5H3Z",
  exposure: "M8 2.5 13.5 5v3.5c0 3.2-2.3 5.2-5.5 6-3.2-.8-5.5-2.8-5.5-6V5Z",
  runners: "M5 3.5h6l1.5 3v6H3.5v-6Zm2 9.5v2m2-2v2M6.5 8h3",
  platform: "M2.5 11.5h11V14h-11Zm1.5-8h8v6h-8Z",
  apps: "M3 3h4v4H3Zm6 0h4v4H9ZM3 9h4v4H3Zm6 0h4v4H9Z",
};

const Icon = ({ name }: { name: string }) => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" className="shrink-0">
    <path
      d={ICONS[name]}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const itemClass = (active: boolean, collapsed: boolean) =>
  `flex items-center gap-2 rounded-md py-1.5 text-[13px] font-medium no-underline ${
    collapsed ? "justify-center px-0" : "px-2"
  } ${active ? "bg-selected text-fg" : "text-muted"}`;

/**
 * Signed-in frame: left sidebar (icons when collapsed, remembered per browser),
 * Platform tabs on those paths, bottom bar at 390px.
 */
export const Shell = ({
  session,
  settings,
  children,
}: {
  session: Session;
  settings: OidcClientDiscovery | null;
  children: ReactNode;
}) => {
  const path = useRouterState({ select: (state) => state.location.pathname });
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [searchOpen, setSearchOpen] = useState(false);
  const toggle = () => {
    setCollapsed((current) => {
      const next = !current;
      writeCollapsed(next);
      return next;
    });
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex min-h-screen bg-page">
      <aside
        className={`sticky top-0 flex h-screen max-phone:hidden ${collapsed ? "w-[52px]" : "w-52"} shrink-0 flex-col border-r border-line`}
      >
        <div
          className={`px-3 pt-3 pb-2 text-[13px] font-semibold ${collapsed ? "text-center" : ""}`}
        >
          {collapsed ? "T" : "Tenkai"}
        </div>
        <nav aria-label="Main" className="flex flex-1 flex-col gap-0.5 px-1.5">
          {MAIN_ITEMS.map((item) => (
            <Link
              key={item.label}
              to={item.to}
              title={collapsed ? item.label : undefined}
              aria-current={activeMain(path) === item.label ? "page" : undefined}
              className={itemClass(activeMain(path) === item.label, collapsed)}
            >
              <Icon name={item.icon} />
              {!collapsed && item.label}
            </Link>
          ))}
          {collapsed ? (
            APP_ITEMS.map((item) => (
              <Link
                key={item.label}
                to={item.to}
                title={item.label}
                aria-current={appItemActive(path, item.to) ? "page" : undefined}
                className={itemClass(appItemActive(path, item.to), true)}
              >
                <Icon name={item.icon} />
              </Link>
            ))
          ) : (
            <>
              <div className="mt-3 px-2 text-[13px] font-medium text-muted">Apps</div>
              {APP_ITEMS.map((item) => (
                <Link
                  key={item.label}
                  to={item.to}
                  aria-current={appItemActive(path, item.to) ? "page" : undefined}
                  className={itemClass(appItemActive(path, item.to), false)}
                >
                  <Icon name={item.icon} />
                  {item.label}
                </Link>
              ))}
            </>
          )}
        </nav>
        <div className="mt-auto border-t border-line px-1.5 py-2">
          <Button
            variant="ghost"
            className="mb-1 w-full"
            onClick={toggle}
            aria-pressed={collapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? "›" : "Collapse"}
          </Button>
          <Account session={session} settings={settings} collapsed={collapsed} />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="min-w-0 flex-1 px-6 py-5 max-phone:px-3 max-phone:pb-16">
          {isPlatformPath(path) && <PlatformTabs path={path} />}
          {children}
        </main>
      </div>
      {searchOpen && (
        <Suspense fallback={null}>
          <QuickSearch onClose={() => setSearchOpen(false)} />
        </Suspense>
      )}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 hidden border-t border-line bg-page max-phone:flex"
      >
        {PHONE_ITEMS.map((item) => (
          <Link
            key={item.label}
            to={item.to}
            aria-current={activeMain(path) === item.label ? "page" : undefined}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] no-underline ${
              activeMain(path) === item.label ? "text-fg" : "text-muted"
            }`}
          >
            <Icon name={item.icon} />
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
};

const PlatformTabs = ({ path }: { path: string }) => (
  <nav aria-label="Platform" className="mb-4 flex gap-4 overflow-x-auto text-[13px] font-medium">
    {PLATFORM_TABS.map((tab) => (
      <Link
        key={tab.label}
        to={tab.to}
        aria-current={path === tab.to ? "page" : undefined}
        className={`shrink-0 ${tabClass(path === tab.to)}`}
      >
        {tab.label}
      </Link>
    ))}
  </nav>
);

const Account = ({
  session,
  settings,
  collapsed,
}: {
  session: Session;
  settings: OidcClientDiscovery | null;
  collapsed: boolean;
}) => {
  const leave = useSignOut(settings);
  const [open, setOpen] = useState(false);
  const label = session.subject ?? (session.kind === "token" ? "token" : "signed in");
  return (
    <div className="relative">
      <Button
        variant="ghost"
        className="w-full"
        aria-expanded={open}
        title={collapsed ? label : undefined}
        onClick={() => setOpen(!open)}
      >
        {collapsed ? label.slice(0, 1) : `${label} ▾`}
      </Button>
      {open && (
        <div className="absolute bottom-full left-0 z-10 mb-1 w-56 border border-line bg-page p-2 text-xs">
          <div className="truncate px-1.5 py-1">{session.subject ?? "bearer token"}</div>
          <div className="truncate px-1.5 pb-1 text-muted">{signInMethod(session, settings)}</div>
          {session.kind === "host" ? (
            <p className="m-0 px-1.5 py-1 text-muted">{HOST_SIGN_OUT}</p>
          ) : (
            <button
              type="button"
              className="w-full cursor-pointer rounded px-1.5 py-1 text-left text-fg hover:bg-selected"
              onClick={() => void leave()}
            >
              Sign out
            </button>
          )}
        </div>
      )}
    </div>
  );
};
