import { useState } from "react";
import type { OidcClientDiscovery } from "../api/tenkai.gen";
import type { Session } from "../auth/session";
import { useSignOut } from "../auth/use-sign-out";
import { Button } from "../ui/kit";

const TABS = ["Delivery", "Releases", "Environments", "Access"] as const;

/** Decision 4D: four top-level tabs, no second menu, account menu on the right. */
export const TopBar = ({
  active,
  session,
  settings,
}: {
  active: (typeof TABS)[number];
  session: Session;
  settings: OidcClientDiscovery | null;
}) => {
  const leave = useSignOut(settings);
  const [open, setOpen] = useState(false);

  return (
    <header className="flex flex-wrap items-center gap-2.5 border-b border-line px-6 py-2.5">
      <span className="text-[13px] font-semibold">Tenkai</span>
      <span className="text-xs text-muted">{window.location.host}</span>
      <nav className="ml-3 flex gap-4 text-[13px] font-medium">
        {TABS.map((tab) => (
          <span
            key={tab}
            className={
              tab === active
                ? "py-1.5 text-fg shadow-[inset_0_-2px_0_var(--color-primary)]"
                : "py-1.5 text-muted"
            }
          >
            {tab}
          </span>
        ))}
      </nav>
      <div className="relative ml-auto">
        <Button variant="ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
          {session.subject ?? (session.kind === "token" ? "token" : "signed in")} ▾
        </Button>
        {open && (
          <div className="absolute right-0 z-10 mt-1 w-56 rounded-md border border-line bg-card p-2 text-xs">
            <div className="truncate px-1.5 py-1 text-muted">
              {session.subject ?? "bearer token"}
            </div>
            <button
              type="button"
              className="w-full cursor-pointer rounded px-1.5 py-1 text-left text-fg hover:bg-selected"
              onClick={() => void leave()}
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
};
